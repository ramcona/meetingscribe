import { execFile, exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import { convertAudioToWav } from './localWhisper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GGML_TINY_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin';
const WHISPER_CPP_GIT = 'https://github.com/ggml-org/whisper.cpp.git';

function getWhisperBinDir() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  return path.join(dataDir, 'whisper-bin');
}

function getWhisperCliPath() {
  const binDir = getWhisperBinDir();
  const ext = process.platform === 'win32' ? '.exe' : '';
  // Try build/bin/whisper-cli (newer releases) and build/main (older)
  const candidates = [
    path.join(binDir, 'repo', 'build', 'bin', `whisper-cli${ext}`),
    path.join(binDir, 'repo', 'build', `main${ext}`),
    path.join(binDir, 'repo', 'build', 'bin', `main${ext}`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Also check system paths
  const systemPaths = [
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    '/opt/homebrew/bin/whisper-cpp',
    '/usr/local/bin/whisper-cpp',
  ];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getGgmlModelPath(modelName = 'ggml-tiny.bin') {
  const binDir = getWhisperBinDir();
  return path.join(binDir, 'models', modelName);
}

export function isWhisperCppAvailable() {
  return getWhisperCliPath() !== null;
}

export function findWhisperCppBinary() {
  return getWhisperCliPath();
}

export function getWhisperSetupStatus() {
  const binDir = getWhisperBinDir();
  const binaryPath = getWhisperCliPath();
  const modelPath = getGgmlModelPath();
  const modelReady = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1000000;
  return {
    binaryReady: binaryPath !== null,
    binaryPath: binaryPath,
    modelReady,
    modelPath: modelReady ? modelPath : null,
    ready: binaryPath !== null && modelReady,
    engine: binaryPath !== null ? 'whisper.cpp' : 'onnx',
  };
}

// ─── Download helpers ──────────────────────────────────────────────────────

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    const doGet = (u) => {
      protocol.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return doGet(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;

        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) {
            onProgress(Math.round((received / total) * 100), received, total);
          }
        });

        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(destPath); });
        res.on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
    };

    doGet(url);
  });
}

// ─── Step 1: Clone whisper.cpp source ─────────────────────────────────────

function cloneWhisperRepo(onLog) {
  return new Promise((resolve, reject) => {
    const binDir = getWhisperBinDir();
    const repoDir = path.join(binDir, 'repo');

    if (fs.existsSync(path.join(repoDir, 'CMakeLists.txt'))) {
      onLog('Repo sudah ada, skip clone.');
      return resolve(repoDir);
    }

    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    onLog('Mengkloning whisper.cpp dari GitHub (shallow)...');
    const git = spawn('git', ['clone', '--depth', '1', WHISPER_CPP_GIT, repoDir]);

    git.stdout.on('data', d => onLog(d.toString().trim()));
    git.stderr.on('data', d => onLog(d.toString().trim()));
    git.on('close', (code) => {
      if (code !== 0) return reject(new Error(`git clone gagal (exit ${code})`));
      resolve(repoDir);
    });
  });
}

// ─── Step 2: cmake configure ──────────────────────────────────────────────

function cmakeConfigure(repoDir, onLog) {
  return new Promise((resolve, reject) => {
    const buildDir = path.join(repoDir, 'build');
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

    onLog('Menjalankan cmake configure...');

    // Enable CoreML + Metal on macOS for max Apple Silicon performance
    const args = [
      '-B', buildDir,
      '-S', repoDir,
      '-DCMAKE_BUILD_TYPE=Release',
    ];
    if (process.platform === 'darwin') {
      args.push('-DGGML_METAL=ON');
    }

    const cmake = spawn('cmake', args);
    cmake.stdout.on('data', d => onLog(d.toString().trim()));
    cmake.stderr.on('data', d => onLog(d.toString().trim()));
    cmake.on('close', (code) => {
      if (code !== 0) return reject(new Error(`cmake configure gagal (exit ${code})`));
      resolve(buildDir);
    });
  });
}

// ─── Step 3: cmake build ──────────────────────────────────────────────────

function cmakeBuild(repoDir, onLog) {
  return new Promise((resolve, reject) => {
    const buildDir = path.join(repoDir, 'build');
    const cpuCount = 4; // safe default

    onLog(`Mengcompile whisper.cpp (${cpuCount} thread)... Ini mungkin 2-5 menit.`);

    const cmake = spawn('cmake', ['--build', buildDir, '-j', String(cpuCount), '--config', 'Release', '--target', 'whisper-cli']);
    cmake.stdout.on('data', d => onLog(d.toString().trim()));
    cmake.stderr.on('data', d => onLog(d.toString().trim()));
    cmake.on('close', (code) => {
      if (code !== 0) {
        // Try building 'main' target as fallback (older whisper.cpp)
        onLog('whisper-cli target tidak ada, mencoba target "main"...');
        const cmake2 = spawn('cmake', ['--build', buildDir, '-j', String(cpuCount), '--config', 'Release', '--target', 'main']);
        cmake2.stdout.on('data', d => onLog(d.toString().trim()));
        cmake2.stderr.on('data', d => onLog(d.toString().trim()));
        cmake2.on('close', (code2) => {
          if (code2 !== 0) return reject(new Error(`cmake build gagal (exit ${code2})`));
          resolve();
        });
        return;
      }
      resolve();
    });
  });
}

// ─── Step 4: Download GGML model ──────────────────────────────────────────

function downloadGgmlModel(onLog, onProgress) {
  return new Promise(async (resolve, reject) => {
    const modelsDir = path.join(getWhisperBinDir(), 'models');
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

    const modelPath = getGgmlModelPath();
    if (fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1000000) {
      onLog('Model ggml-tiny.bin sudah ada.');
      return resolve(modelPath);
    }

    onLog('Mengunduh model ggml-tiny.bin dari HuggingFace (~75MB)...');
    try {
      await downloadFile(GGML_TINY_URL, modelPath, (pct, recv, total) => {
        onProgress(pct, recv, total);
      });
      onLog('Model berhasil diunduh!');
      resolve(modelPath);
    } catch (err) {
      reject(new Error(`Gagal unduh model: ${err.message}`));
    }
  });
}

// ─── Main setup orchestrator ──────────────────────────────────────────────

/**
 * Full whisper.cpp on-demand setup.
 * emitProgress(stage, pct, message)
 *  - stage: 'clone' | 'compile' | 'model' | 'done' | 'error'
 */
export async function runWhisperCppSetup(emitProgress) {
  const log = (msg) => emitProgress('log', 0, msg);

  try {
    const binDir = getWhisperBinDir();
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    // --- 1. Check cmake ---
    emitProgress('check', 5, 'Memeriksa cmake...');
    await new Promise((resolve, reject) => {
      exec('cmake --version', (err) => {
        if (err) return reject(new Error('cmake tidak ditemukan. Install Xcode Command Line Tools dulu: xcode-select --install'));
        resolve();
      });
    });

    // --- 2. Clone ---
    emitProgress('clone', 10, 'Mengkloning repositori whisper.cpp...');
    const repoDir = await cloneWhisperRepo(log);
    emitProgress('clone', 25, 'Clone selesai.');

    // --- 3. cmake configure ---
    emitProgress('compile', 30, 'Menjalankan cmake configure...');
    await cmakeConfigure(repoDir, log);
    emitProgress('compile', 40, 'Configure selesai. Mulai compile...');

    // --- 4. cmake build ---
    emitProgress('compile', 45, 'Sedang mengcompile whisper.cpp binary...');
    await cmakeBuild(repoDir, log);
    emitProgress('compile', 70, 'Compile selesai!');

    // --- 5. Verify binary ---
    const binPath = getWhisperCliPath();
    if (!binPath) throw new Error('Binary hasil compile tidak ditemukan. Pastikan Xcode Command Line Tools terinstall.');
    emitProgress('compile', 75, `Binary siap: ${binPath}`);

    // --- 6. Download model ---
    emitProgress('model', 78, 'Mulai unduh model ggml-tiny.bin...');
    await downloadGgmlModel(log, (pct, recv, total) => {
      const overall = 78 + Math.round(pct * 0.20);
      const mb = (recv / 1024 / 1024).toFixed(1);
      const totalMb = (total / 1024 / 1024).toFixed(1);
      emitProgress('model', overall, `Mengunduh model: ${mb}MB / ${totalMb}MB (${pct}%)`);
    });

    emitProgress('done', 100, 'whisper.cpp siap! Transkripsi Metal GPU aktif.');
  } catch (err) {
    emitProgress('error', 0, err.message);
    throw err;
  }
}

// ─── Transcription functions ───────────────────────────────────────────────

export async function transcribeWithWhisperCpp(filePath, options = {}) {
  const whisperBin = getWhisperCliPath();
  if (!whisperBin) throw new Error('whisper.cpp binary not found. Run setup first.');

  const modelPath = getGgmlModelPath();
  if (!fs.existsSync(modelPath)) throw new Error('GGML model not found. Run setup first.');

  const lang = options.language || 'id';
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  const tempWavPath = path.join(dataDir, `temp_wcpp_${Date.now()}.wav`);
  const jsonOutputPath = `${tempWavPath}.json`;

  try {
    await convertAudioToWav(filePath, tempWavPath);

    const args = ['-m', modelPath, '-f', tempWavPath, '-oj', '-l', lang, '-t', '6'];
    await new Promise((resolve, reject) => {
      execFile(whisperBin, args, (error, stdout, stderr) => {
        if (error) return reject(new Error(`whisper.cpp failed: ${error.message}`));
        resolve(stdout);
      });
    });

    let segments = [];
    if (fs.existsSync(jsonOutputPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonOutputPath, 'utf8'));
      const raw = parsed.transcription || [];
      let speaker = 1;
      let lastEnd = 0;

      segments = raw.map((item, idx) => {
        const start = (item.offsets?.from || 0) / 1000;
        const end = (item.offsets?.to || start * 1000 + 4000) / 1000;
        if (start - lastEnd > 1.8 && idx > 0) speaker = (speaker % 3) + 1;
        lastEnd = end;
        return { speaker_label: `Orang ${speaker}`, text: (item.text || '').trim(), start_time: start, end_time: end, segment_order: idx + 1 };
      }).filter(s => s.text.length > 0);
    }

    try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch (e) {}
    try { if (fs.existsSync(jsonOutputPath)) fs.unlinkSync(jsonOutputPath); } catch (e) {}
    return segments;
  } catch (err) {
    try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch (e) {}
    try { if (fs.existsSync(jsonOutputPath)) fs.unlinkSync(jsonOutputPath); } catch (e) {}
    throw err;
  }
}

export async function transcribeLiveChunkWhisperCpp(audioBuffer) {
  const whisperBin = getWhisperCliPath();
  if (!whisperBin) return null;

  const modelPath = getGgmlModelPath();
  if (!fs.existsSync(modelPath)) return null;

  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
  const id = Date.now() + Math.random().toString(36).substring(2, 6);
  const tempChunkPath = path.join(dataDir, `tmp_live_${id}.webm`);
  const tempWavPath = path.join(dataDir, `tmp_live_${id}.wav`);
  const jsonOutputPath = `${tempWavPath}.json`;

  try {
    fs.writeFileSync(tempChunkPath, audioBuffer);
    await convertAudioToWav(tempChunkPath, tempWavPath);

    const args = ['-m', modelPath, '-f', tempWavPath, '-oj', '-l', 'id', '-t', '4', '--no-timestamps'];
    await new Promise((resolve, reject) => {
      execFile(whisperBin, args, { timeout: 30000 }, (error) => {
        if (error) return reject(error);
        resolve();
      });
    });

    let text = '';
    if (fs.existsSync(jsonOutputPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonOutputPath, 'utf8'));
      text = (parsed.transcription || []).map(t => t.text).join(' ').trim();
    }

    try { if (fs.existsSync(tempChunkPath)) fs.unlinkSync(tempChunkPath); } catch (e) {}
    try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch (e) {}
    try { if (fs.existsSync(jsonOutputPath)) fs.unlinkSync(jsonOutputPath); } catch (e) {}
    return text;
  } catch (err) {
    try { if (fs.existsSync(tempChunkPath)) fs.unlinkSync(tempChunkPath); } catch (e) {}
    try { if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath); } catch (e) {}
    try { if (fs.existsSync(jsonOutputPath)) fs.unlinkSync(jsonOutputPath); } catch (e) {}
    return null;
  }
}
