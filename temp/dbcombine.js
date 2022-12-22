const Sqlite3Database = require('better-sqlite3')

function combine() {
    const db1 = new Sqlite3Database("./temp/txs_tnode.db")
    const db2 = new Sqlite3Database("./temp/txs_api.db")

    console.log(db1)
    let sql = "select * from txs"
    const ret = db1.prepare(sql).all()
    for (const tx of ret) {
        try {
            sql = "insert or replace into txs (txid,bytes,height,time,txTime,chain) values (?,?,?,?,?,?)"
            const r = db2.prepare(sql).run(tx.txid, tx.bytes, tx.height, tx.time, tx.txTime, tx.chain)
            //console.log(r)
        } catch (e) {
            console.log(e.message)
        }
    }
    db1.close()
    db2.close()
}
combine()