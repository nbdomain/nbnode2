/**
 * run-connect.js
 *
 * Run Connect API. Currently it only supports fetches.
 */

const axios = require('axios')

// ------------------------------------------------------------------------------------------------
// RunConnectFetcher
// ------------------------------------------------------------------------------------------------

class RunConnectFetcher {
  async connect(height, blockchain) {
    this.network = "main"
  }

  async fetch(txid) {
    let response;
    //const response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
    let hex;
    try {
      response = await axios.get(`https://api.whatsonchain.com/v1/bsv/${this.network}/tx/${txid}/hex`)
      hex = response.data
    }catch(e){
      response = await axios.get(`https://api.run.network/v1/${this.network}/tx/${txid}`)
      hex = response.data.hex
    }
    if (!hex) {
      console.error("Download rawtx failed");
    }
    const height = typeof response.data.blockheight === 'number' ? response.data.blockheight : null
    const time = typeof response.data.blocktime === 'number' ? response.data.blocktime : null
    return { hex, height, time }
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = RunConnectFetcher
