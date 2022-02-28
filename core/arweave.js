/**
 * NbNode.js
 *
 * NbNode API
 */

const axios = require('axios')
//global.EventSource = require('eventsource')
const { default: ReconnectingEventSource } = require('reconnecting-eventsource')
const Arweave = require('arweave');

// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------
// NbNode
// ------------------------------------------------------------------------------------------------
let ar_node = null
class AWNode {
  constructor(apiKey, logger) {
    this.suffix = apiKey ? `?api_key=${apiKey}` : ''
    this.logger = logger
    this.mempoolTimerID = 0
    this.lastCrawlHeight = 0
    this.lastCrawHash = null
    this.recrawlInterveral = 30000

    this.txs = []
    this.arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https'
    });
    ar_node = this
    //setTimeout(this._crawl.bind(this), 30000)
  }
  static async sendRawTx(rawtx){
    if(ar_node){
      const jsonTx = JSON.parse(rawtx)
      const tx = await ar_node.arweave.createTransaction(jsonTx)
      console.log("ar sending...")
      const response = await ar_node.arweave.transactions.post(tx);
      return {code:response.status==200?0:1,txid:jsonTx.id,msg:response.statusText}
    }
    return {code:1,message:"arnode not initialized"}
  }

  async connect(height, chain) {
    if (chain !== 'ar') throw new Error(`chain not supported with NbNode: ${network}`)

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
        transactions(tags: $tags, block:$block,sort: HEIGHT_ASC) {
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

    const response = await this.arweave.api.post('graphql', {
      query, variables
    });
//    console.log(response.data)
    return response.data.data ? response.data.data.transactions : null
  }
  async fetch(txid) {
    //const tx = await this.arweave.transactions.get(txid)
    console.log("ar: fetching ",txid," return null")
    return {hex:"{}",height:0,time:0}
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
    //console.log(txs);

    for (let item of txs.edges) {
      let height = item.node.block.height
      let time = item.node.block.timestamp
      let block = this.txs.find(bl => bl.height === height)
      if (!block) {
        block = { height: height, time:time, hash: item.node.block.id, txids: [], txhexs: [] }
        this.txs.push(block)
      }

      let tags = {}
      item.node.tags.forEach(tag => tags[tag.name] = tag.value)
      item.node.tags = tags
      if(!tags.cmd){
        const data = await this.arweave.transactions.getData(item.node.id,{decode:false,string:true})
        if(data)item.node.data = data
        //console.log(data)
      }
      //if (item.node.block&&(item.node.block.timestamp * 1000 < tags.ts)) continue //ts must before block time
      block.txids.push(item.node.id)
      block.txhexs.push(JSON.stringify(item.node))
    }
    const current = await this.arweave.blocks.getCurrent();
    if(current){
      this.lastCrawlHeight = current.height
      this.lastCrawHash = current.hash
    }
  }
  async getNextBlock(currHeight, currHash) {
    try {
      if(this.txs.length>0)
        return this.txs.shift()

      return {height:this.lastCrawlHeight,hash:this.lastCrawHash,txids:[],txhexs:[]}
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
