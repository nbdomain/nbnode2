const DB = require('better-sqlite3')
const fs = require('fs')
class Database {
    constructor(path) {
        if (!fs.existsSync(path)) {
            fs.copyFileSync(__dirname + "/data/template/txHistory.db", path);
        }
        this.db = new DB(path)
        // 100MB cache
        this.db.pragma('cache_size = 6400')
        this.db.pragma('page_size = 16384')
    }
    setTx(item, chain = 'bsv') {
        try {
            let sql = "INSERT INTO txs (txid,block,raw,main,ts,addresses,fee) VALUES(?,?,?,?,?,?,?)"
            if (chain == 'ar') sql = sql.replace('txs', 'artx')
            this.db.prepare(sql).run(item.txid, item.block, item.raw, JSON.stringify(item.main), item.ts, item.addresses, item.fee)
        } catch (e) {
            console.error(e)
        }
    }
    saveTxs(txs, chain = 'bsv') {
        for (let tx of txs) {
            if (tx.dirty) {
                this.setTx(tx, chain)
                delete tx.dirty
            }
        }
    }
    getTxHistory({ address, num, start, end, chain = 'bsv' }) {
        let sql = "SELECT * from txs where addresses like ? AND block > ? AND block < ? LIMIT ?"
        if (chain == 'ar') sql = sql.replace('txs', 'artx')
        const res = this.db.prepare(sql).all("%" + address + "%", start, end, num)
        return { c: res }
    }
    isLocal(block, chain = 'bsv') {
        let sql = "SELECT * from txs where block > ?"
        if (chain == 'ar') sql = sql.replace('txs', 'artx')
        const res = this.db.prepare(sql).get(block)
        return res != null
    }
    getTx(tx, chain = 'bsv') {
        let sql = "SELECT * from txs where txid = ?"
        if (chain == 'ar') sql = sql.replace('txs', 'artx')
        const res = this.db.prepare(sql).get(tx.txid)
        if (res) {
            tx = res
            tx.main = JSON.parse(tx.main)
            delete tx.id
        }
        return tx
    }
    getTxs(txs, chain = 'bsv') {
        for (let i = 0; i < txs.length; i++) {
            txs[i] = this.getTx(txs[i], chain)
        }
    }
    getTransaction(txid) {
        return null
    }
}

module.exports = Database