/**
 * CLC Kernel - .clckernel.yaml for install and update.
 * The schema lives in tools/_config.js, which the guards use too: one
 * validator for the kernel and the project. Invalid config -> ConfigError
 * naming the file and the key; never a silent fallback.
 */

const {
  ConfigError,
  CONFIG_NAMES,
  DEPRECATED_KEYS,
  defaultConfig,
  validateConfig,
  parseConfigText,
  loadConfig: loadProjectConfig,
  globMatcher,
} = require('../tools/_config.js');

/**
 * Parses config text into its raw mapping ({} for an empty document).
 * @param {string} yamlString
 * @param {string} [file] - Config file name, for messages
 * @returns {object}
 * @throws {ConfigError}
 */
const loadConfig = (yamlString, file) => parseConfigText(yamlString, file);

/**
 * Reads, validates and defaults the config of the project at dir (fresh
 * read: install and update must see the file as it is now).
 * @param {string} dir - Project root
 * @returns {{ file: string|null, path: string|null, config: object, warnings: string[] }}
 * @throws {ConfigError}
 */
function readProjectConfig(dir) {
  return loadProjectConfig(dir, { cache: false });
}

module.exports = {
  ConfigError,
  CONFIG_NAMES,
  DEPRECATED_KEYS,
  defaultConfig,
  loadConfig,
  validateConfig,
  readProjectConfig,
  globMatcher,
};
