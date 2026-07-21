import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes.js';
import { initLogger, logger } from './logger.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
initLogger(dataDir);

const app = express();
const PORT = process.env.NODE_ENV === 'test' ? 0 : (process.env.PORT || 3001);

const recordingsDir = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'recordings')
  : path.join(__dirname, '../data/recordings');

app.use(cors());
app.use(express.json());
app.use('/recordings', express.static(recordingsDir));

// Mount API router
app.use('/api', apiRouter);

// Ping endpoint for basic connectivity testing
app.get('/api/ping', (req, res) => {
  res.json({ message: 'pong' });
});

// Basic error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server', `Unhandled Server Error: ${err.message}`, err.stack);
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const server = app.listen(PORT, () => {
  logger.info('Server', `Express Backend listening on http://localhost:${PORT}`);
  console.log(`Server running on http://localhost:${PORT}`);

  if (process.env.NODE_ENV !== 'test') {
    import('./audioUtils.js').then(m => m.repairDatabaseAudioDurationsAndTimestamps()).catch(err => console.error(err));

    // Background Google Calendar auto-sync loop (every 60 seconds)
    const runAutoCalendarSync = async () => {
      try {
        const { getUpcomingCalendarEvents } = await import('./googleCalendar.js');
        const { dbHelpers } = await import('./db.js');
        const events = await getUpcomingCalendarEvents();
        if (events && events.length > 0) {
          dbHelpers.upsertGoogleCalendarEvents(events);
        }
      } catch (err) {
        // Silent sync catch
      }
    };

    // Initial sync on startup & 60-second polling interval
    runAutoCalendarSync();
    setInterval(runAutoCalendarSync, 60000);
  }
});

export { app, server };
