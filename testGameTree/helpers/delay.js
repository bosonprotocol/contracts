/**
 * provides delay
 * @returns {Promise<*>}
 */
const wait = require('wait');

async function delay() {
    await wait(10000);
}

module.exports = delay;