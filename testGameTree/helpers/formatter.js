/* eslint @typescript-eslint/no-var-requires: "off" */

// Formats the input data into a tabular format
let Table = require("cli-table");

async function formatter(_input) {
  let table = new Table({
    head: ["PARAMETER", "VALUE"],
  });
  let listArray = Object.entries(_input);
  // table is an Array, so you can `push`, `unshift`, `splice` and friends
  for (let i = 0; i < listArray.length; i++) {
    table.push(listArray[i]);
  }
  console.log(table.toString());
}

module.exports = formatter;
