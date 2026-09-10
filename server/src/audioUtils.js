import { execFile } from 'child_process';
import fs from 'fs';
import { dbHelpers } from './db.js';

// Format seconds to [MM:SS]
export function formatTime(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Extracts exact audio duration in seconds from a media file on disk.
 * Handles Chrome WebM files (which lack duration headers) via ffmpeg frame decoding fallback.
 */
export function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve(0);
    }

    const TIMEOUT_MS = 15000; // 15-second hard limit per probe attempt

    // 1. Try ffprobe container header first (fast)
    const probeProc = execFile('ffprobe', ['-i', filePath, '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0'], (err, stdout) => {
      const headerDur = parseFloat(stdout ? stdout.trim() : '');
      if (!err && !isNaN(headerDur) && headerDur > 0) {
        return resolve(headerDur);
      }

      // 2. Fallback to ffmpeg stream decode (handles Chrome WebM without duration headers)
      const decodeProc = execFile('ffmpeg', ['-i', filePath, '-f', 'null', '-'], (err2, stdout2, stderr2) => {
        if (stderr2) {
          const matches = [...stderr2.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const hours = parseFloat(lastMatch[1]);
            const minutes = parseFloat(lastMatch[2]);
            const seconds = parseFloat(lastMatch[3]);
            const totalSec = hours * 3600 + minutes * 60 + seconds;
            if (!isNaN(totalSec) && totalSec > 0) {
              return resolve(totalSec);
            }
          }
        }
        resolve(0);
      });

      const decodeTimer = setTimeout(() => {
        try { decodeProc.kill(); } catch (e) {}
        console.warn('[AudioUtils] ffmpeg decode timed out for:', filePath);
        resolve(0);
      }, TIMEOUT_MS);

      decodeProc.on('close', () => clearTimeout(decodeTimer));
    });

    const probeTimer = setTimeout(() => {
      try { probeProc.kill(); } catch (e) {}
      console.warn('[AudioUtils] ffprobe timed out for:', filePath);
      resolve(0);
    }, TIMEOUT_MS);

    probeProc.on('close', () => clearTimeout(probeTimer));
  });
}

/**
 * Validates and scales segment timestamps so they never exceed actual audio duration.
 * If Gemini returned inflated timestamps (e.g. 58 mins for a 36 min audio), this proportionally
 * rescales all start_time and end_time entries so they align perfectly with the actual audio timeline.
 */
export function normalizeAndRescaleSegments(segments, actualDuration) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const sanitized = segments.map((seg, idx) => ({
    ...seg,
    start_time: Math.max(0, parseFloat(seg.start_time) || 0),
    end_time: Math.max(0, parseFloat(seg.end_time) || 0),
    segment_order: seg.segment_order || idx + 1
  }));

  if (!actualDuration || actualDuration <= 0) {
    return sanitized;
  }

  // Find highest end_time in returned segments
  const maxEndTime = Math.max(...sanitized.map(s => s.end_time));

  // If timestamps exceed actual duration or are significantly bloated (scale ratio > 1.02)
  if (maxEndTime > actualDuration || (maxEndTime > 0 && maxEndTime / actualDuration > 1.02)) {
    const scaleFactor = actualDuration / maxEndTime;
    console.log(`[AudioUtils] Rescaling timestamps: maxEndTime=${maxEndTime}s -> actualDuration=${actualDuration}s (scaleFactor=${scaleFactor.toFixed(4)})`);

    return sanitized.map(seg => {
      const scaledStart = Math.min(actualDuration, parseFloat((seg.start_time * scaleFactor).toFixed(1)));
      const scaledEnd = Math.min(actualDuration, parseFloat((seg.end_time * scaleFactor).toFixed(1)));
      return {
        ...seg,
        start_time: Math.max(0, scaledStart),
        end_time: Math.max(scaledStart, scaledEnd)
      };
    });
  }

  // Ensure all end_time entries are hard-capped to actualDuration
  return sanitized.map(seg => ({
    ...seg,
    start_time: Math.min(actualDuration, seg.start_time),
    end_time: Math.min(actualDuration, Math.max(seg.start_time, seg.end_time))
  }));
}

/**
 * One-time / startup database audit & repair.
 * Detects meetings with 0 duration_seconds or segment timestamps exceeding actual audio file length
 * and retroactively fixes them in sqlite database.
 */
export async function repairDatabaseAudioDurationsAndTimestamps() {
  try {
    const meetings = dbHelpers.listMeetings();
    for (const meeting of meetings) {
      if (meeting.audio_path && fs.existsSync(meeting.audio_path)) {
        const realDuration = await getAudioDuration(meeting.audio_path);
        const roundedDuration = Math.round(realDuration);

        // 1. Fix duration_seconds in meetings table if 0 or inaccurate
        if (roundedDuration > 0 && (meeting.duration_seconds === 0 || Math.abs(meeting.duration_seconds - roundedDuration) > 5)) {
          console.log(`[AudioUtils Repair] Updating meeting ${meeting.id} duration from ${meeting.duration_seconds}s to ${roundedDuration}s`);
          dbHelpers.updateMeeting(meeting.id, { duration_seconds: roundedDuration });
        }

        // 2. Fix transcript segments if max timestamp exceeds realDuration
        const segments = dbHelpers.getTranscriptSegments(meeting.id);
        if (segments && segments.length > 0 && realDuration > 0) {
          const maxEndTime = Math.max(...segments.map(s => s.end_time));
          if (maxEndTime > realDuration + 2) {
            console.log(`[AudioUtils Repair] Repairing transcript timestamps for meeting "${meeting.title}" (${meeting.id}): maxEndTime ${maxEndTime}s > realDuration ${realDuration}s`);
            const normalized = normalizeAndRescaleSegments(segments, realDuration);

            // Update database segments
            dbHelpers.updateMeeting(meeting.id, { status: meeting.status }); // touch updated_at
            
            // Delete old segments and insert rescaled ones
            // We use raw database execute if available, or update via dbHelpers
            const db = (await import('./db.js')).default;
            db.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meeting.id);
            dbHelpers.addTranscriptSegments(normalized.map((seg, idx) => ({
              meeting_id: meeting.id,
              speaker_label: seg.speaker_label,
              speaker_name: seg.speaker_name || null,
              text: seg.text,
              start_time: seg.start_time,
              end_time: seg.end_time,
              segment_order: idx + 1
            })));
            console.log(`[AudioUtils Repair] Successfully repaired ${normalized.length} segments for meeting ${meeting.id}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('[AudioUtils Repair Error]', err);
  }
}
