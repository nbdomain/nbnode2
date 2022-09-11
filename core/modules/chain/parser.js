const bsv = require('bsv')
const axios = require('axios')
const { add } = require('bsv/lib/networks')
const {WOCAPI} = require('./APIs')

class Parser{
    constructor(crawler,db){
        this.crawler = crawler
        this.db = db
    }
    async parseRaw(txin,utxos){
        const rawtx = txin.raw
        const tx = bsv.Transaction(rawtx)
        txin.addresses = ""
        let addresses = new Set
        let main = {from:[],to:[]}
        let value_in = 0,value_out=0
       // if(txin.txid=="ebe2748696387c030983fbf4f279ba62a8aec7e7c61fdf64d593e0d7d236c186"){
           // console.log("found")
       // }
        for(const inp of tx.inputs){
            let address = null
            const preTxid = inp.prevTxId.toString('hex')
            const sc = new bsv.Script.fromBuffer(inp._scriptBuffer)
            try{
                address = bsv.Address.fromScript(sc).toString()
            }catch(e){
                address = ""
            }
            //const amount = await WOCAPI.getUtxoValue(preTxid,inp.outputIndex)
            let amount = 0
            const utxo = utxos.find(u=>(u.txid==preTxid)&&(u.pos==inp.outputIndex))
            if(utxo)amount = utxo.value
            main.from.push({address:address,value:amount})
            if(address)
                addresses.add(address)
            value_in+=amount
        }
        for(const out of tx.outputs){
            let address = null
            const sc = new bsv.Script.fromBuffer(out._scriptBuffer)
            try{
            address = bsv.Address.fromScript(sc).toString()
            }catch(e){
                address = ""
            }
            main.to.push({address:address,value:out._satoshis})
            if(address)
                addresses.add(address)
            value_out+=out._satoshis
        }
        txin.fee = value_in - value_out
        if(txin.fee<0){
            console.log("found negative fee")
        }
        txin.main = main
        txin.dirty = true
        addresses.forEach(address=>txin.addresses+=address+";")
        return txin
    }
}
/*const crawler = new Crawler()
const parser = new Parser(crawler)
const rawtx = "0100000001844049b1a7b1a983354671859ba183d2573fed8d8a97904aee2bac98bee64ead010000006b483045022100fef4948f6eb62e624688317b0d857da0387925ea2e1f67857587b6f7ceb76658022018863ca4467a3cf9483700640d2f4504d38a0eb07f91658334c63cbc51c481074121032a60f4d65452ddbd2a65b5845847b0bc1b91d9c2c81f3ea8bb0d26f2b18f32e4ffffffff02e8030000000000001976a9142864ccd14341f2c51875f1b456d035d3053abdfe88ac26f84200000000001976a9140d30866582a51caa1a2b8bd1eb3d3dd8feee2b2d88ac00000000"
parser.parseRaw(rawtx)*/
module.exports = Parser