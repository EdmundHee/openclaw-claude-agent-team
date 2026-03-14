import fs from 'fs';
import path from 'path';

/**
 * Global Session Scanner
 *
 * Scans ALL projects in ~/.claude/projects/ and returns sessions
 * with their decoded project name and full path, so the dashboard
 * can show which agent is working on which project.
 *
 * Claude Code encodes project paths as directory names:
 *   /Users/edmund/my-project → Users-edmund-my-project
 *
 * We decode this back to a human-readable project name and full path.
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

        // Decode the full project path and short name
        const decoded = this._decodeProjectDir(projectDir);

        try {
          const files = fs.readdirSync(projectPath);
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;

            const filePath = path.join(projectPath, file);
            try {
              const fileStat = fs.statSync(filePath);
              const age = Date.now() - fileStat.mtimeMs;
              const active = age < ACTIVE_THRESHOLD_MS;

              sessions.push({
                file: filePath,
                sessionId: path.basename(file, '.jsonl'),
                project: decoded.name,
                projectPath: decoded.fullPath,
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

  /**
   * Decode Claude Code's project directory hash back to a path.
   *
   * Claude Code replaces /, \, : with - in the path.
   * e.g. "Users-edmund-code-my-project" → /Users/edmund/code/my-project
   *
   * We reconstruct the most likely original path and extract the
   * last meaningful directory name as the short project name.
   */
  _decodeProjectDir(dirName) {
    // Reconstruct path by replacing - with /
    const reconstructed = '/' + dirName.replace(/-/g, '/');

    // Try to find a real directory that matches
    // Check progressively longer paths
    let bestPath = reconstructed;
    const parts = dirName.split('-');

    // Walk from root trying to find actual directories
    let current = '';
    let lastValidPath = '';
    for (const part of parts) {
      const trySlash = current + '/' + part;
      const tryDash = current + '-' + part;

      if (current === '') {
        current = '/' + part;
        if (fs.existsSync(current)) lastValidPath = current;
      } else if (fs.existsSync(trySlash)) {
        current = trySlash;
        lastValidPath = current;
      } else if (fs.existsSync(tryDash)) {
        current = tryDash;
        lastValidPath = current;
      } else {
        current = trySlash;
      }
    }

    bestPath = lastValidPath || reconstructed;

    // Extract short name: last directory component
    const shortName = path.basename(bestPath);

    return {
      name: shortName || dirName,
      fullPath: bestPath
    };
  }
}
