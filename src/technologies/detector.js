/**
 * CLC Kernel — TechnologyDetector
 * Detects Phase-1 technologies (Celery, Redis, PostgreSQL, Docker) via file signatures.
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {'celery' | 'redis' | 'postgresql' | 'docker'} Technology
 */

/**
 * TechnologyDetector scans a project root for Phase-1 technology signatures.
 */
class TechnologyDetector {
  /**
   * Detect which Phase-1 technologies are present in targetDir.
   * @param {string} targetDir - Project root path
   * @returns {Technology[]} Array of detected technology identifiers
   */
  detect(targetDir) {
    /** @type {Technology[]} */
    const detected = [];

    try {
      if (!fs.existsSync(targetDir)) {
        return [];
      }

      // Celery detection
      if (this._detectCelery(targetDir)) {
        detected.push('celery');
      }

      // Redis detection
      if (this._detectRedis(targetDir)) {
        detected.push('redis');
      }

      // PostgreSQL detection
      if (this._detectPostgresql(targetDir)) {
        detected.push('postgresql');
      }

      // Docker detection
      if (this._detectDocker(targetDir)) {
        detected.push('docker');
      }
    } catch (err) {
      console.warn(`[TechnologyDetector] Error during detection: ${err.message}`);
    }

    return detected;
  }

  /**
   * @param {string} targetDir
   * @returns {boolean}
   */
  _detectCelery(targetDir) {
    // Check requirements.txt
    if (this._matchInFile(targetDir, 'requirements.txt', 'celery')) {
      return true;
    }

    // Check pyproject.toml
    if (this._matchInFile(targetDir, 'pyproject.toml', 'celery')) {
      return true;
    }

    // Check celery.py or celeryconfig.py
    const celeryFiles = ['celery.py', 'celeryconfig.py', 'celery_app.py'];
    for (const file of celeryFiles) {
      if (fs.existsSync(path.join(targetDir, file))) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {string} targetDir
   * @returns {boolean}
   */
  _detectRedis(targetDir) {
    // Check requirements.txt
    if (this._matchInFile(targetDir, 'requirements.txt', 'redis')) {
      return true;
    }

    // Check pyproject.toml
    if (this._matchInFile(targetDir, 'pyproject.toml', 'redis')) {
      return true;
    }

    // Check redis.conf
    if (fs.existsSync(path.join(targetDir, 'redis.conf'))) {
      return true;
    }

    // Check for redis:// URL in .env files
    if (this._containsRedisUrl(targetDir)) {
      return true;
    }

    return false;
  }

  /**
   * @param {string} targetDir
   * @returns {boolean}
   */
  _detectPostgresql(targetDir) {
    // Check for psycopg2, asyncpg, or psycopg2-binary
    const pgPackages = ['psycopg2', 'asyncpg', 'psycopg2-binary'];

    for (const pkg of pgPackages) {
      if (this._matchInFile(targetDir, 'requirements.txt', pkg)) {
        return true;
      }
      if (this._matchInFile(targetDir, 'pyproject.toml', pkg)) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {string} targetDir
   * @returns {boolean}
   */
  _detectDocker(targetDir) {
    if (fs.existsSync(path.join(targetDir, 'Dockerfile'))) {
      return true;
    }
    if (fs.existsSync(path.join(targetDir, 'docker-compose.yml'))) {
      return true;
    }
    return false;
  }

  /**
   * Check if a file exists and contains a case-insensitive substring.
   * @param {string} targetDir
   * @param {string} filename
   * @param {string} pattern
   * @returns {boolean}
   */
  _matchInFile(targetDir, filename, pattern) {
    const filePath = path.join(targetDir, filename);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.toLowerCase().includes(pattern.toLowerCase());
    } catch (err) {
      console.warn(`[TechnologyDetector] Could not read ${filePath}: ${err.message}`);
      return false;
    }
  }

  /**
   * Check for redis:// URL in .env files.
   * @param {string} targetDir
   * @returns {boolean}
   */
  _containsRedisUrl(targetDir) {
    try {
      const entries = fs.readdirSync(targetDir);
      for (const entry of entries) {
        if (entry === '.env' || entry.startsWith('.env.')) {
          const filePath = path.join(targetDir, entry);
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.toLowerCase().includes('redis://')) {
            return true;
          }
        }
      }
    } catch (err) {
      // Ignore read errors
    }
    return false;
  }

  /**
   * Returns tool manifest entries for detected technologies.
   * @param {Technology[]} technologies
   * @returns {Array<{name: string, language: string, path: string, command: string, description: string}>}
   */
  getToolsForTech(technologies) {
    /** @type {Array<{name: string, language: string, path: string, command: string, description: string}>} */
    const tools = [];

    for (const tech of technologies) {
      switch (tech) {
        case 'celery':
          tools.push({
            name: 'celery_guard',
            language: 'py',
            path: 'celery_guard.py',
            command: 'python3 tools/celery_guard.py',
            description: 'Celery guard: broker URL exposure, missing ignore_result on @shared_task, hardcoded result backend',
          });
          break;
        case 'redis':
          tools.push({
            name: 'redis_guard',
            language: 'py',
            path: 'redis_guard.py',
            command: 'python3 tools/redis_guard.py',
            description: 'Redis guard: decode_responses without password check, missing socket_connect_timeout, hardcoded Redis URLs',
          });
          break;
        case 'postgresql':
          tools.push({
            name: 'postgres_guard',
            language: 'py',
            path: 'postgres_guard.py',
            command: 'python3 tools/postgres_guard.py',
            description: 'PostgreSQL guard: raw SQL with string formatting, hstore raw usage',
          });
          break;
        case 'docker':
          tools.push({
            name: 'docker_guard',
            language: 'py',
            path: 'docker_guard.py',
            command: 'python3 tools/docker_guard.py',
            description: 'Docker guard: non-root USER, ENV secrets exposure, missing HEALTHCHECK',
          });
          break;
      }
    }

    return tools;
  }
}

module.exports = { TechnologyDetector };
