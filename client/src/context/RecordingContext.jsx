import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { getAudioInputDevices, startAudioRecording } from '../utils/audioMixer';

const RecordingContext = createContext(null);

export function RecordingProvider({ children }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [meetingId, setMeetingId] = useState(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [duration, setDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Device selections
  const [devices, setDevices] = useState([]);
  const [micId, setMicId] = useState('');
  const [systemId, setSystemId] = useState('');
  const [useTabCapture, setUseTabCapture] = useState(false);

  // Stream previews
  const [micStreamPreview, setMicStreamPreview] = useState(null);
  const [systemStreamPreview, setSystemStreamPreview] = useState(null);

  // Recording refs
  const recorderRef = useRef(null);
  const activeStreamsRef = useRef({ mic: null, system: null, mixed: null });
  const audioContextRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    const inputDevices = await getAudioInputDevices();
    setDevices(inputDevices);
    if (inputDevices.length > 0) {
      const defaultMic = inputDevices.find(d => d.deviceId === 'default') || inputDevices[0];
      setMicId(prev => prev || defaultMic.deviceId);

      const blackhole = inputDevices.find(d => d.label.toLowerCase().includes('blackhole'));
      if (blackhole) {
        setSystemId(prev => prev || blackhole.deviceId);
      }
    }
  };

  const stopPreviews = () => {
    if (micStreamPreview) {
      micStreamPreview.getTracks().forEach(t => t.stop());
      setMicStreamPreview(null);
    }
    if (systemStreamPreview) {
      systemStreamPreview.getTracks().forEach(t => t.stop());
      setSystemStreamPreview(null);
    }
  };

  const stopRecordingResources = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    const streams = activeStreamsRef.current;
    if (streams.mic) streams.mic.getTracks().forEach(t => t.stop());
    if (streams.system) streams.system.getTracks().forEach(t => t.stop());
    if (streams.mixed) streams.mixed.getTracks().forEach(t => t.stop());
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    activeStreamsRef.current = { mic: null, system: null, mixed: null };
    recorderRef.current = null;
  };

  const startRecording = async (targetMeetingId, title = '') => {
    setErrorMessage('');
    stopPreviews();

    try {
      const config = await startAudioRecording({
        micDeviceId: micId,
        systemDeviceId: !useTabCapture ? systemId : null,
        useTabCapture
      });

      recorderRef.current = config.recorder;
      activeStreamsRef.current = {
        mic: config.micStream,
        system: config.systemStream,
        mixed: config.mixedStream
      };
      audioContextRef.current = config.audioContext;

      chunksRef.current = [];
      
      recorderRef.current.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorderRef.current.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setMeetingId(targetMeetingId);
      setMeetingTitle(title || 'Rekaman Meeting');
      setDuration(0);

      try {
        await fetch(`http://localhost:3001/api/meetings/${targetMeetingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'recording',
            recording_started_at: new Date().toISOString()
          })
        });
      } catch (patchErr) {
        console.error('Failed to update status on start:', patchErr);
      }

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Error starting recording:', err);
      setErrorMessage(err.message || 'Gagal memulai perekaman. Pastikan izin microphone dan system audio telah diberikan.');
      loadDevices();
    }
  };

  const pauseRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'paused') {
      recorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
  };

  const stopAndSaveRecording = async (onSuccess) => {
    if (!recorderRef.current || !isRecording) return;

    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsPaused(false);
    setUploading(true);

    const activeMeetingId = meetingId;

    // Trigger stop on recorder
    const currentRecorder = recorderRef.current;
    currentRecorder.stop();

    // Wait short tick for final data chunk
    await new Promise(res => setTimeout(res, 200));

    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    stopRecordingResources();

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('duration_seconds', duration.toString());
    
    const startedAt = new Date(Date.now() - duration * 1000).toISOString();
    formData.append('recording_started_at', startedAt);

    try {
      const res = await fetch(`http://localhost:3001/api/meetings/${activeMeetingId}/recording`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        setUploading(false);
        setMeetingId(null);
        if (onSuccess) onSuccess(activeMeetingId);
      } else {
        const errData = await res.json();
        setErrorMessage(errData.error || 'Gagal mengunggah file rekaman.');
        setUploading(false);
      }
    } catch (err) {
      console.error('Error saving recording:', err);
      setErrorMessage('Terjadi kesalahan koneksi saat mengunggah file rekaman.');
      setUploading(false);
    }
  };

  return (
    <RecordingContext.Provider value={{
      isRecording,
      isPaused,
      meetingId,
      meetingTitle,
      duration,
      uploading,
      errorMessage,
      setErrorMessage,
      devices,
      micId,
      setMicId,
      systemId,
      setSystemId,
      useTabCapture,
      setUseTabCapture,
      micStreamPreview,
      setMicStreamPreview,
      systemStreamPreview,
      setSystemStreamPreview,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopAndSaveRecording,
      activeStreams: activeStreamsRef.current,
      stopPreviews,
      loadDevices
    }}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  return useContext(RecordingContext);
}
