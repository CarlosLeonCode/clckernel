/**
 * CLC Kernel — TechnologyDetector
 * Detects technologies via file signatures: Celery, Redis, PostgreSQL and
 * Docker, a Supabase CLI project, a configured SQL migrations folder, a Node
 * data client and an MCP server (sdds/laila-platform-fit).
 */

const fs = require('fs');
const path = require('path');

/**
 * @typedef {'celery' | 'redis' | 'postgresql' | 'docker' | 'supabase' | 'sql-migrations' | 'data-client' | 'mcp'} Technology
 */

/** Node packages that query a database (check_query_efficiency, check_mcp_contracts). */
const DATA_CLIENTS = ['@supabase/supabase-js', 'drizzle-orm', '@prisma/client', 'postgres', 'pg'];
const MCP_SDK = '@modelcontextprotocol/sdk';

/** Display name of each technology (install summary, AGENTS.md, update plan). */
const TECHNOLOGY_LABELS = {
  celery: 'Celery',
  redis: 'Redis',
  postgresql: 'PostgreSQL',
  docker: 'Docker',
  supabase: 'Supabase',
  'sql-migrations': 'SQL migrations',
  'data-client': 'Database client',
  mcp: 'MCP server',
};

/**
 * TechnologyDetector scans a project root for Phase-1 technology signatures.
 */
class TechnologyDetector {
  /**
   * Detect which technologies are present in targetDir.
   * @param {string} targetDir - Project root or part dir
   * @param {{ sqlMigrationPaths?: string[] }} [options] - Globs of a configured
   *   SQL migrations folder (.clckernel.yaml `sql_migrations.paths`)
   * @returns {Technology[]} Array of detected technology identifiers
   */
  detect(targetDir, options = {}) {
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

      // Supabase CLI project
      if (fs.existsSync(path.join(targetDir, 'supabase', 'config.toml'))) {
        detected.push('supabase');
      }

      // A configured SQL migrations folder that exists
      if (this._detectSqlMigrations(targetDir, options.sqlMigrationPaths)) {
        detected.push('sql-migrations');
      }

      const deps = this._packageDeps(targetDir);
      if (DATA_CLIENTS.some((name) => Object.prototype.hasOwnProperty.call(deps, name))) {
        detected.push('data-client');
      }
      if (Object.prototype.hasOwnProperty.call(deps, MCP_SDK)) {
        detected.push('mcp');
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
   * dependencies + devDependencies of targetDir/package.json ({} without one).
   * @param {string} targetDir
   * @returns {object}
   */
  _packageDeps(targetDir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
      return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch {
      return {};
    }
  }

  /**
   * True when a configured migrations glob names a folder that exists: the
   * glob's literal leading segments (before the first wildcard) form a
   * directory of targetDir.
   * @param {string} targetDir
   * @param {string[]|undefined} globs
   * @returns {boolean}
   */
  _detectSqlMigrations(targetDir, globs) {
    if (!Array.isArray(globs)) return false;
    return globs.some((glob) => {
      const literal = [];
      for (const segment of glob.split('/')) {
        if (/[*?{[]/.test(segment)) break;
        literal.push(segment);
      }
      if (literal.length === 0 || literal.length === glob.split('/').length) return false;
      try {
        return fs.statSync(path.join(targetDir, ...literal)).isDirectory();
      } catch {
        return false;
      }
    });
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
      const known = tools.find((t) => t.path === TECH_GUARDS[tech]?.path);
      if (known) {
        if (!known.technologies.includes(tech)) known.technologies.push(tech);
        continue;
      }
      if (TECH_GUARDS[tech]) {
        tools.push({ ...TECH_GUARDS[tech], technology: TECHNOLOGY_LABELS[tech], technologies: [tech] });
        continue;
      }
      const before = tools.length;
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
      for (const tool of tools.slice(before)) Object.assign(tool, { technology: TECHNOLOGY_LABELS[tech], technologies: [tech] });
    }

    return tools;
  }
}

/** Guards of the technologies added by sdds/laila-platform-fit (JS, stack-agnostic). */
const SQL_MIGRATIONS_GUARD = {
  name: 'check_sql_migrations',
  language: 'js',
  path: 'check_sql_migrations.js',
  command: 'node tools/check_sql_migrations.js',
  description: 'SQL migration guard: applied migrations unchanged, row level security on new tables, security definer search_path, no write grants to anon, drops named',
};
const TECH_GUARDS = {
  supabase: SQL_MIGRATIONS_GUARD,
  'sql-migrations': SQL_MIGRATIONS_GUARD,
  'data-client': {
    name: 'check_query_efficiency',
    language: 'js',
    path: 'check_query_efficiency.js',
    command: 'node tools/check_query_efficiency.js',
    description: 'Query efficiency guard: awaited database calls inside loops (N+1), unbounded select(\'*\') without limit/range',
  },
  mcp: {
    name: 'check_mcp_contracts',
    language: 'js',
    path: 'check_mcp_contracts.js',
    command: 'node tools/check_mcp_contracts.js',
    description: 'MCP contract guard: tool input schemas imported from the contracts modules (no inline z.object), no data client imports in tool files',
  },
};

/**
 * AGENTS.md lines for the technology guards of a config: one per guard,
 * naming its technologies and the file the hook runs. [] without any.
 * @param {Array} techTools - config.techTools
 * @returns {string[]}
 */
function technologySafeguards(techTools) {
  return (techTools || []).map((tool) => {
    const labels = (tool.technologies || []).map((tech) => TECHNOLOGY_LABELS[tech] || tech);
    return `${labels.join(' / ') || tool.name}: ${tool.description} (tools/${tool.path})`;
  });
}

/** Display names of the technologies of a config, in detection order, once each. */
function technologyNames(techTools) {
  return [...new Set((techTools || []).flatMap((tool) => (tool.technologies || []).map((tech) => TECHNOLOGY_LABELS[tech] || tech)))];
}

module.exports = { TechnologyDetector, TECHNOLOGY_LABELS, DATA_CLIENTS, technologySafeguards, technologyNames };
