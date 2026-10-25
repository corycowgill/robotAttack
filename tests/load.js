// Loads the game's data, rules and AI into Node (they are plain browser scripts
// that also export themselves for CommonJS).
const path = require('path');
const root = path.join(__dirname, '..');
const config = require(path.join(root, 'config.js'));
Object.assign(global, config);
global.Rules = require(path.join(root, 'rules.js'));
global.AI = require(path.join(root, 'ai.js'));
global.Realtime = require(path.join(root, 'realtime.js'));
module.exports = { ...config, Rules: global.Rules, AI: global.AI, Realtime: global.Realtime };
