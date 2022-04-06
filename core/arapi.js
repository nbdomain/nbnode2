/**
 * NbNode.js
 *
 * NbNode API
 */

const axios = require('axios')
//global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')

const CoinFly = require('coinfly')
const Nodes = require("./nodes")
const { Util } = require('./util')

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------
// NbNode
// ------------------------------------------------------------------------------------------------
let ar_node = null
const NumOfRecords = 100
class AWNode {
  constructor(apiKey, db, logger) {
    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolTimerID = 0
    this.lastCrawlHeight = 0
    this.lastCrawHash = null
    this.recrawlInterveral = 30000
    this.db = db

    this.txs = []

    ar_node = this
    //setTimeout(this._crawl.bind(this), 30000)
  }
  static async sendRawTx(rawtx) {
    if (ar_node) {
      const jsonTx = JSON.parse(rawtx)
      const tx = await ar_node.arweave.createTransaction(jsonTx)
      console.log("ar sending...")
      const response = await ar_node.arweave.transactions.post(tx);
      return { code: response.status == 200 ? 0 : 1, txid: jsonTx.id, msg: response.statusText }
    }
    return { code: 1, message: "arnode not initialized" }
  }
  static async verifyTx(rawtx) {
    if (ar_node) {
      const jsonTx = JSON.parse(rawtx)
      try {
        const tx = await ar_node.arweave.transactions.fromRaw(jsonTx)
        return await ar_node.arweave.transactions.verify(tx);
      } catch (e) {
        //console.error("verifyTx failed ar tx:",jsonTx.id)
        return false
      }
    }
    return false
  }

  async connect(height, chain) {
    if (chain !== 'ar') throw new Error(`chain not supported with NbNode: ${network}`)
    this.lib = await CoinFly.create('ar')
    this.arweave = this.lib.ar
    this.lastCrawlHeight = height

    this.logger.info('Crawling for new blocks via arweave')
    await this._recrawl()
  }

  async disconnect() {
    if (this.mempoolTimerID) {
      clearTimeout(this.mempoolTimerID)
      this.mempoolTimerID = 0
    }
  }
  async queryTx(tags, block) {
    const variables = { tags: tags, block: block }
    const query = `query Transactions($tags: [TagFilter!], $block: BlockFilter){
        transactions(tags: $tags, block:$block,first:${NumOfRecords},sort: HEIGHT_ASC) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              owner { 
                address
                key
              }
              recipient
              tags {
                name
                value
              }
              block {
                height
                id
                timestamp
              }
              fee { winston }
              quantity { winston }
              parent { id }
            }
            cursor
          }
        }
      }`;

    const response = await this.lib.graphQL({
      query, variables
    });
    //    console.log(response.data)
    return response.data.data ? response.data.data.transactions : null
  }
  async fetch(txid) {
    //const tx = await this.arweave.transactions.get(txid)
    console.log("ar: fetching ", txid, " return null")
    return { hex: "{}", height: 0, time: 0 }
  }
  async _recrawl() {
    const scheduleRecrawl = () => {
      this.recrawlTimerId = setTimeout(this._recrawl.bind(this), this.recrawlInterveral)
    }

    return this._crawl()
      .then(() => {
        scheduleRecrawl()
      })
      .catch(e => {
        this.logger.error(e)
        this.logger.info('Retrying crawl in ' + this.recrawlInterveral / 1000 + ' seconds')
        scheduleRecrawl()
      })
  }
  async _crawl() {
    let height = this.lastCrawlHeight + 1
    const txs = await this.queryTx({ name: "nbprotocol", values: ["nbd"] }, { min: height })
    if (!txs) return;

    let bigHeight = height;
    for (let item of txs.edges) {
      if (this.db.hasTransaction(item.node.id, 'ar')) continue

      let height = item.node.block && item.node.block.height
      let time = item.node.block && item.node.block.timestamp
      let block = this.txs.find(bl => bl.height === height)
      if (height > bigHeight) { bigHeight = height }
      if (!block) {
        block = { height: height, time: time, hash: item.node.block.id, txids: [], txhexs: [] }
        this.txs.push(block)
      }

      let tags = {}
      item.node.tags.forEach(tag => tags[tag.name] = tag.value)
      item.node.tags = tags
      if (!tags.cmd) {
        try {
          const data = await this.lib.getData(item.node.id, { decode: false, string: true })
          if (data) item.node.data = data
        } catch (e) {
          const d = await Nodes.getData(item.node.id, 'ar')
          if (d) {
            console.log("got from peers")
            item.node.data = d
          } else
            console.error(e.message + " txid:", item.node.id)
        }

      }
      block.txids.push(item.node.id)
      block.txhexs.push(JSON.stringify(item.node))
    }
    try {
      const current = await this.arweave.blocks.getCurrent();
      if (current) {
        this.lastCrawHash = "unknown"
        if (current.height < bigHeight) {
          this.lastCrawHash = bigHeight
        } else {
          this.lastCrawlHeight = bigHeight + NumOfRecords
          if (this.lastCrawlHeight > current.height) {
            this.lastCrawlHeight = current.height
            this.lastCrawHash = current.hash
          }
        }
      }
    } catch (e) {
      console.error(e.code)
      this.lib.changeNode("http://gateway-7.arweave.net:1984");
    }
  }
  async getNextBlock(currHeight, currHash) {
    try {
      if (this.txs.length > 0)
        return this.txs.shift()

      return { height: this.lastCrawlHeight, hash: this.lastCrawHash, txids: [], txhexs: [] }
    } catch (e) {
      console.log(e)
      throw e
    }
  }

  async listenForMempool(mempoolTxCallback) {
    /*  const txs = await this.queryTx({ name: "protocol", values: ["nbtest2"] }, { max: 0 })
      console.log(txs);
      for (let item of txs.edges) {
        mempoolTxCallback(item.node.id, item.node)
      }*/
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = AWNode
