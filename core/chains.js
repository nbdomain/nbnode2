const TXO = require("./txo.js");
const { DEF } = require("./def");
const { ArUtil, Util } = require("./util")
const BitID = require('bitidentity');
class ARChain {
    static async verify(rawtx, height) {
        const rtx = await ARChain.raw2rtx({ rawtx, height })
        return { code: rtx ? 0 : 1, txTime: rtx.ts }
    }
    static async raw2rtx({ rawtx, height }) {
        try {
            const tx = JSON.parse(rawtx);
            let tags = ArUtil.decodeTags(tx.tags)
            const nbdata = JSON.parse(tags.nbdata)
            const ts = JSON.parse(nbdata[1]).ts
            let cmd = null
            try{
                cmd =  JSON.parse(tags.cmd)
            }catch(e){}
            if(!cmd){
                if(typeof tx.data !=undefined) cmd = JSON.parse(ArUtil.decode(tx.data))
                else{
                    cmd = await ArUtil.getTxData(tx.id)
                }
            }
            let out = [], out0 = {e:{}}, i = 0
            for (; i < nbdata.length; i++) {
                out0['s' + i] = nbdata[i]
            }
            for (let j = 0; j < cmd.length; j++, i++) {
                out0['s' + i] = cmd[j]
            }
            out.push(out0)
            tx.tags = tags
            let rtx = {
                height: height,
                ts: +ts,
                txid: tx.id,
                publicKey: tx.owner.key ? tx.owner.key : tx.owner,
                command: cmd[0],
                output: null,
                out: out,
            };
            rtx.inputAddress = await Util.addressFromPublickey(rtx.publicKey, 'ar')
            if(rtx.inputAddress==tx.target){ // ar chain does not allow send to self
                return null
            }
            rtx.chain = 'ar'
            return rtx
        } catch (e) {
            console.error(e)
            return null
        }
    }
}
class BSVChain {
    static verifySig(rawtx) { //retuen publicKey or null
        let rtxVerified = BitID.verifyID(rawtx)
        if (!rtxVerified) {
            return null
        }
        let keyArray = BitID.getBitID(rawtx)
        if (keyArray.length > 0) {
            return keyArray[0].publicKey.toString()
        }
        return null
    }
    static async verify(rawtx, height, block_time) {
        let txTime = null
        if (!height || height == -1 || height > DEF.BLOCK_SIGNATURE_UPDATE) {
            const publicKey = BSVChain.verifySig(rawtx)
            if (!publicKey) {
                return { code: -1, msg: `Failed to verify transaction signature.` }
            }
        }
        if (block_time) { //check txtime
            const rtx = await BSVChain.raw2rtx({ rawtx, height, time: block_time })
            txTime = rtx.ts
            if (rtx.ts && rtx.ts > block_time)
                return { code: -1, msg: 'txTime invalid' }
        }
        return { code: 0, txTime: txTime }
    }
    static _reArrage(rtx) {
        if (rtx.out[0].s2 === "nbd") {
            for (let i = 2; i < rtx.out[0].len; i++) {
                rtx.out[0]["s" + (i + 2)]
                    ? (rtx.out[0]["s" + i] = rtx.out[0]["s" + (i + 2)])
                    : "";
                rtx.out[0]["b" + (i + 2)]
                    ? (rtx.out[0]["b" + i] = rtx.out[0]["b" + (i + 2)])
                    : "";
                rtx.out[0]["h" + (i + 2)]
                    ? (rtx.out[0]["h" + i] = rtx.out[0]["h" + (i + 2)])
                    : "";
                rtx.out[0]["f" + (i + 2)]
                    ? (rtx.out[0]["f" + i] = rtx.out[0]["f" + (i + 2)])
                    : "";
            }
        }
    }
    static async raw2rtx({ rawtx, height, time }) {
        const tx = TXO.fromRaw(rawtx);
        let rtx = {
            height: height,
            time: time,
            txid: tx.tx.h,
            publicKey: tx.in[0].h1.toString(),
            command: tx.out[0].s2 == "nbd" ? tx.out[0].s6 : tx.out[0].s4,
            // inputAddress: tx.in[0].e.a.toString(),
            output: null,
            in: tx.in,
            out: tx.out,
        };
        if (tx.out[0].s2 == "nbd" && tx.out[0].s3 != "1") {
            try {
                const attrib = JSON.parse(tx.out[0].s3)
                rtx.ts = +attrib.ts
            } catch (e) { }

        }
        tx.in.forEach(inp => { if (inp.e.a) rtx.inputAddress = inp.e.a.toString() })
        BSVChain._reArrage(rtx)
        rtx.chain = 'bsv'
        return rtx
    }
}

module.exports = {
    ARChain, BSVChain
}