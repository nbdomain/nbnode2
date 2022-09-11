// server.js
// where your node app starts

// init project
let indexers = null
const MP = require('./mpoints');
const mPoints = new MP();

module.exports = function (env) {
  indexers = env.indexers;
  return new Promise((resolve) => {
    mPoints.start((port) => {
      resolve(port)
    });
  })
}