/**
 * provides delay
 * @returns {Promise<*>}
 */
const wait = require('wait');

async function delay() {
    await wait(30000);
}

module.exports = delay;