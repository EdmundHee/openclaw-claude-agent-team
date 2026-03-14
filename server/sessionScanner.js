import fs from 'fs';
import path from 'path';

/**
 * Scans ~/.claude/projects/ for active JSONL session files.
 * A session is considered "active" if it was modified within the last 10 minutes.
 */

const ACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export class SessionScanner {
  constructor(claudeDir) {
    this.claudeDir = claudeDir;
  }

  async scan() {
    const sessions = [];

    if (!fs.existsSync(this.claudeDir)) {
      return sessions;
    }

    try {
      const projectDirs = fs.readdirSync(this.claudeDir);

      for (const projectDir of projectDirs) {
        const projectPath = path.join(this.claudeDir, projectDir);
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) continue;

        try {
          const files = fs.readdirSync(projectPath);
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;

            const filePath = path.join(projectPath, file);
            try {
              const fileStat = fs.statSync(filePath);
              const age = Date.now() - fileStat.mtimeMs;
              const active = age < ACTIVE_THRESHOLD_MS;

              // Decode project name from hash
              const projectName = this._decodeProjectDir(projectDir);

              sessions.push({
                file: filePath,
                sessionId: path.basename(file, '.jsonl'),
                project: projectName,
                projectDir: projectDir,
                modifiedAt: fileStat.mtimeMs,
                size: fileStat.size,
                active
              });
            } catch (e) {
              // Skip inaccessible files
            }
          }
        } catch (e) {
          // Skip inaccessible dirs
        }
      }
    } catch (e) {
      // Claude dir not readable
    }

    // Sort by most recently modified
    sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return sessions;
  }

  _decodeProjectDir(dirName) {
    // Claude Code encodes project paths: /home/user/project -> home-user-project
    // Try to make it human readable
    const parts = dirName.split('-');
    // Take last meaningful segment as project name
    if (parts.length > 0) {
      return parts[parts.length - 1] || dirName;
    }
    return dirName;
  }
}
