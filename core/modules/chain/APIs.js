const axios = require('axios')
const es = require("event-stream")
//const { SensibleFT, API_NET, API_TARGET, SensibleApi, Wallet } = require("sensible-sdk");

class ARAPI {
    static async getTxHistory({ address, num, start, end }) {
        let txs = await ARAPI._getTxHistory({ address, num, start, end, type: 'spend' })
        const txs1 = await ARAPI._getTxHistory({ address, num, start, end, type: 'income' })
        txs.c = txs.c.concat(txs1.c)
        txs.u = txs.u.concat(txs1.u)
        txs.c = txs.c.sort((first, second) => second.ts > first.ts ? 1 : -1)
        if (num) {
            txs.c.splice(num, txs.c.length - num)
        }
        console.log(txs)
        return txs
    }
    static async _getTxHistory({ address, num, start, end, type }) {
        let block = {}
        if (start) block.min = start
        if (end) block.max = end
        let query = `
            query Transactions($address:[String!]$1BLOCK$1NUM){transactions($TYPE: $address$BLOCK$NUM) {
              pageInfo {
                hasNextPage
              }
              edges {
                node {
                  id
                  owner { 
                    address
                  }
                  recipient
                  tags {
                    name
                    value
                  }
                  block {
                    height
                    timestamp
                  }
                  fee { winston }
                  quantity { winston }
                }
                cursor
              }
          }}`;

        let url = "https://arweave.net/graphql", res = null
        const variables = { address: [address] }
        if (block.min || block.max) {
            query = query.replace('$1BLOCK', ',$block: BlockFilter')
            query = query.replace('$BLOCK', ",block:$block")
            variables.block = block
        }
        if (num) {
            query = query.replace('$1NUM', ',$first: Int')
            query = query.replace('$NUM', ",first:$first")
            variables.first = num
        }
        query = query.replace('$TYPE', type == 'spend' ? 'owners' : 'recipients')
        query = query.replace('$NUM', "")
        query = query.replace('$BLOCK', "")
        query = query.replace('$1BLOCK', "")
        try {
            res = await axios.post(url, { query, variables }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept-Encoding': 'gzip, deflate',
                    'Origin': 'https://arweave.net'
                }
            })
        } catch (e) {
            console.log(e.response)
            return { code: 1, c: [], u: [] }
        }
        let txs = { code: 0, c: [], u: [] };
        const data = res.data.data.transactions.edges
        for (let i = 0; i < data.length; i++) {
            const item = data[i]
            let tx = {}
            if (item.node.block) tx = { txid: item.node.id, block: item.node.block.height, ts: item.node.block.timestamp, fee: Math.floor(+item.node.fee.winston / 10000), type: type }
            else tx = { txid: item.node.id, block: -1, ts: Math.floor(Date.now() / 1000), fee: Math.floor(+item.node.fee.winston / 10000), type: type }
            type == 'spend' ? tx.main = { from: [{ address }], to: [{ address: item.node.recipient }] } : tx.main = { from: [{ address: item.node.owner.address }], to: [{ address }] }
            tx.addresses = (address == item.node.recipient ? address + ";" + item.node.owner.address : address + ";" + item.node.recipient)
            tx.amount = Math.floor(+item.node.quantity.winston / 10000)
            if (type == 'spend') tx.amount += tx.fee
            tx.block != -1 ? txs.c.push(tx) : txs.u.push(tx)
        }
        return txs
    }
}
class WOCAPI {
    static async getTxHistory({ address, num, start, end }) {
        let url = "https://api.whatsonchain.com/v1/bsv/main/address/" + address + "/history"
        if (end == 0) end = 9999999999
        const res = await axios.get(url)
        let txs = { c: [], u: [] };
        for (let i = res.data.length - 1; i >= 0; i--) {
            const item = res.data[i]
            const tx = { txid: item.tx_hash, block: item.height }
            if (item.height != 0) {
                if (item.height >= start && item.height <= end && txs.c.length < num)
                    txs.c.push(tx)
            } else
                txs.u.push(tx)
        }
        return txs
    }
    static async getUtxoValue(utxos) {
        let txids = new Set, i = 0
        const length = utxos.length
        for (let utxo of utxos) {
            const txid = utxo.txid
            i++
            const item = this.db && this.db.getTransaction(txid)
            if (item) {
                utxo.value = item.to[utxo.pos].value
                continue
            }
            txids.add(txid)
            if (txids.size == 20 || i >= length) {
                const res = await axios.post("https://api.whatsonchain.com/v1/bsv/main/txs", { txids: Array.from(txids) })
                if (res.data) {
                    console.log(res.data)
                    for (const item of res.data) {
                        const uu = utxos.filter(u => u.txid == item.txid)
                        uu.forEach(u => u.value = Math.round(item.vout[u.pos].value * 1e8))
                    }
                }
                txids.clear()
            }
        }
        return null
    }
}
class SensibleAPI {
    static async getTxHistory({ address, num, start, end }) {
        if (start && start != 0) start--
        if (end && end != 0) end++
        if (start == 0) start = 650000
        let url = `https://api.sensiblequery.com/address/${address}/history/tx?start=${start}&end=${end}&cursor=0&size=${num * 2}`
        try {

            const res = await axios.get(url)
            if (res && res.data.code == 0) {
                const data = res.data.data
                let txs = { c: [], u: [] };
                for (let i = 0; i < data.length; i++) {
                    const item = data[i]
                    const tx = { txid: item.txid, block: item.height, ts: item.timestamp }
                    if (item.height != 4294967295) txs.c.push(tx)
                    else {
                        tx.block = -1;
                        tx.ts = Math.floor(Date.now() / 1000)
                        txs.u.push(tx)
                    }
                }
                return txs
            } else return { c: [], u: [] }
        } catch (e) {
            return null //api error
        }

    }
}
class PlanAPI {
    static async getTxHistory({ address, num, start, end }) {

        let url = "https://txo.bitbus.network/block";
        const query = {
            q: {
                find: { $or: [{ "in.e.a": address }, { "out.e.a": address }] }, sort: { "blk.i": -1 },
                project: { "tx.h": 1, timestamp: 1, blk: 1 },
                limit: num,
            }
        };
        if (start > 0 || end > 0) query.q.find["blk.i"] = {};
        if (start > 0) query.q.find["blk.i"]["$gt"] = start;
        if (end > 0) query.q.find["blk.i"]["$lt"] = end;
        try {
            let res = await axios.post(url, JSON.stringify(query), {
                headers: {
                    "Content-type": "application/json; charset=utf-8",
                    Accept: "application/json; charset=utf-8",
                    token: "eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxQzc5M0RkVjI0Q3NORTJFUDZNbVZmckhqVlNGVmc2dU4iLCJpc3N1ZXIiOiJnZW5lcmljLWJpdGF1dGgifQ.SUJlYUc2TGNGdFlZaGk3amxwa3ZoRGZJUEpFcGhObWhpdVNqNXVBbkxORTdLMWRkaGNESC81SWJmM2J1N0V5SzFuakpKTWFPNXBTcVJlb0ZHRm5uSi9VPQ"
                },
                responseType: "stream" // important
            });
            let txs = { c: [], u: [] };
            console.log("getting transactions...")
            return new Promise(function (resolve, reject) {
                res.data.on("end", function () {
                    resolve(txs);
                    return;
                });
                res.data.pipe(es.split()).pipe(
                    es.map((data, callback) => {
                        if (data) {
                            let d = JSON.parse(data);
                            const tx = { txid: d.tx.h, block: d.blk.i, ts: d.blk.t }
                            console.log("adding:", tx.txid)
                            txs.c.push(tx);
                        }
                    })
                );
            });
        } catch (e) {
            console.error(e)
            return null
        }
    }
}

module.exports = { WOCAPI, PlanAPI, SensibleAPI, ARAPI }