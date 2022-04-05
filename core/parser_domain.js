
const { Util, CMD_BASE } = require("./util.js");
const { CMD, DEF } = require("./def")
//const DomainTool = require('./domainTool')

class Parser_Domain {
    constructor(chain) {
        this.chain = chain
    }
    init(db) {
        this.db = db;
    }
    parse(rtx) {
        let ret = {
            code: -1, msg: ""
        }
        try {
            const handler = this.getHandler(rtx.command)
            if (handler) {
                rtx.output = handler.parseTX(rtx)
            }
            if (!rtx.output) {
                ret.msg = `Not a valid output: ${rtx.txid}`;
                return ret;
            }
        } catch (err) {
            ret.msg = err.message;
            console.error(err);
            return ret;
        }
        if (rtx.output.err) {
            console.error("parse domain:", rtx.output.err)
        }
        ret.code = 0;
        ret.obj = rtx;
        return ret;
    }
    getHandler(command) {
        const handler = this.getAllCommands()[command]
        if (handler) {
            handler.parser = this
            return handler
        }
        return null
    }
    getAllCommands() {
        return {
            [CMD.KEY]: CMD_KEYUSER, [CMD.USER]: CMD_KEYUSER, [CMD.NOP]: CMD_NOP, [CMD.REGISTER]: CMD_REGISTER,
            [CMD.BUY]: CMD_BUY, [CMD.SELL]: CMD_SELL, [CMD.ADMIN]: CMD_ADMIN, [CMD.TRANSFER]: CMD_TRANSER, [CMD.MAKE_PUBLIC]: CMD_MAKE_PUBLIC
        }
    }
}
class CMD_MAKE_PUBLIC {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        return output;
    }
    static fillObj(nidObj, rtx) {
        try {
            if (nidObj.owner_key == null) return null
            if (nidObj.owner_key == rtx.publicKey) {
                nidObj.status = DEF.STATUS_PUBLIC
            }
        } catch (e) {

        }
        return nidObj
    }
}
class CMD_REGISTER {
    static async parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            // Suppose the output array has a fixed order.
            // output 0 - OP_RETURN.
            output.owner_key = rtx.out[0].s5;
            if (rtx.out[0].s6) {
                var extra = JSON.parse(rtx.out[0].s6);
                output.payTx = extra["pay_txid"];
            }
            try {
                if (rtx.out[0].s7) output.agent = rtx.out[0].s7;
            } catch (e) { }
        } catch (err) {
            console.error(rtx.txid)
            console.log(err)
            output.err = "Invalid format for RegisterOutput class."
            return output
        }

        if (output.owner_key == null || output.owner_key == "") {
            output.err = "Invalid format for RegisterOutput class1."
            return output
        }

        try {
            let addr = await Util.addressFromPublickey(rtx.publicKey, rtx.chain);
            let authorsities = Util.getAdmins(output.protocol, rtx.height);
            if (!authorsities.includes(addr)) {
                output.err = "Input address not in authorities.";
            }
        } catch (err) {
            output.err = "Invalid format for RegisterOutput class2."
        }

        return output
    }
    static async fillObj(nidObj, rtx) {
        try {
            if (nidObj.owner_key) {
                rtx.output.err = nidObj.domain + ": Already registered"
                return null
            }//can't register twice
            nidObj.nid = rtx.output.nid;
            nidObj.owner_key = rtx.output.owner_key;
            nidObj.owner = await Util.addressFromPublickey(nidObj.owner_key, rtx.chain);
            nidObj.txid = rtx.txid;
            nidObj.status = DEF.STATUS_VALID;
            nidObj.domain = rtx.output.domain;
            nidObj.lastUpdateheight = rtx.height;
        } catch (e) {
            rtx.output.err = e.message
            return null //some data is invalid, probably owner_key is not a valid public key
        }
        return nidObj
    }
}
class CMD_BUY {
    static async parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            var extra = JSON.parse(rtx.out[0].s6);
            output.transferTx = extra["sell_txid"];
            output.payTxid = extra["pay_txid"];
            output.agent = rtx.out[0].s7;
            output.owner_key = rtx.out[0].s5;
        } catch (err) {
            output.err = "Invalid format for BuyOutput class."
            return output
        }
        let addr = await Util.addressFromPublickey(rtx.publicKey, rtx.chain) //Util.getAddressFromPublicKey(rtx.publicKey);
        let authorsities = Util.getAdmins(
            output.protocol,
            rtx.height
        );
        if (!authorsities.includes(addr)) {
            output.err = "Input address not in authorities.";
            return output
        }
        return output
    }
    static async fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        if (nidObj.status == DEF.STATUS_TRANSFERING && nidObj.sell_info) {
            //TODO validate
            {
                if (rtx.txTime != -1 && rtx.txTime * 1000 > Number(nidObj.sell_info.expire)) return null //expired
                let clearData = nidObj.sell_info.clear_data;
                if (nidObj.sell_info.buyer != 'any') { //check if it's the right buyer
                    //if (Util.getAddressFromPublicKey(rtx.output.owner_key) != nidObj.sell_info.buyer)
                    if (await Util.addressFromPublickey(rtx.output.owner_key, rtx.chain) != nidObj.sell_info.buyer)
                        return null
                }
                nidObj = await Util.resetNid(nidObj, rtx.output.owner_key, rtx.txid, DEF.STATUS_VALID, clearData, rtx.chain);
            }
        }
        return nidObj
    }
}
class CMD_SELL {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            var extra = JSON.parse(rtx.out[0].s5);
            output.buyer = extra["buyer"];
            output.note = extra["note"];
            output.price = Number(extra["price"]);
            output.expire = Number(extra["expire"]);
            output.clear_data = extra["clear_data"];
        } catch (err) {
            output.err = "Invalid format for SellOutput class."
        }
        return output
    }
    static async fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        if (nidObj.owner_key == rtx.publicKey && nidObj.status != DEF.STATUS_PUBLIC) { //cannot sell public domain
            nidObj.status = DEF.STATUS_TRANSFERING
            //nidObj = DomainTool.updateNidObjFromRX(nidObj, rtx);
            nidObj.sell_info = {
                price: rtx.output.price,
                buyer: rtx.output.buyer,
                expire: rtx.output.expire,
                note: rtx.output.note,
                clear_data: rtx.output.clear_data,
                seller: await Util.addressFromPublickey(rtx.publicKey, rtx.chain), //Util.getAddressFromPublicKey(rtx.publicKey).toString(),
                sell_txid: rtx.txid
            };
            nidObj.tf_update_tx = rtx.txid;
        }
        return nidObj
    }
}
class CMD_NOP {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        return output
    }
    static fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        return nidObj
    }
}
class CMD_TRANSER {
    static async parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            output.owner_key = rtx.out[0].s5.toLowerCase();
            output.transfer_fee = rtx.out[3].e.v;
            output.payment_addr = rtx.out[3].e.a;
            //Util.getAddressFromPublicKey(output.owner_key) //test public key
            await Util.addressFromPublickey(output.owner_key, rtx.chain)
        } catch (err) {
            output.err = "Invalid format for Transfer command."
            return output
        }
        if (output.transfer_fee < 1000) {
            output.err = "Transfer command must pay admin fee 1000 satoshi."
            return output
        }

        return output
    }
    static async fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        try {
            if (nidObj.owner_key == rtx.publicKey && nidObj.status != DEF.STATUS_PUBLIC) { //can not transfer public domain
                //nidObj = DomainTool.updateNidObjFromRX(nidObj, rtx)
                nidObj.owner_key = rtx.output.owner_key;
                nidObj.owner = await Util.addressFromPublickey(rtx.output.owner_key)//Util.getAddressFromPublicKey(rtx.output.owner_key).toString();
            }
        } catch (e) {
            console.error("fillObj: Transfer command invalid")
            return null
        }
        return nidObj
    }
}
class CMD_ADMIN {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            var extra = JSON.parse(rtx.out[0].s5);
            output.key = Object.keys(extra)[0];
            output.value = extra[output.key];
        } catch (err) {
            output.err = "Invalid format for MetaDataOutput class."
        }
        return output
    }
    static fillObj(nidObj, rtx) {
        if (nidObj.owner_key == null) return null
        if (nidObj.owner_key == rtx.publicKey)
            //nidObj = DomainTool.updateNidObjFromRX(nidObj, rtx);
            nidObj.admins = rtx.output.value;
        nidObj.admin_update_tx = rtx.txid;
        return nidObj
    }
}
class CMD_KEYUSER {
    static parseTX(rtx) {
        let output = CMD_BASE.parseTX(rtx);
        try {
            let tags = null, pay = {}, hasPay = false
            output.value = JSON.parse(rtx.out[0].s5);
            try {
                tags = JSON.parse(rtx.out[0].s6).tags;
                if (tags)
                    rtx.command == "key"
                        ? (output.tags = tags)
                        : (output.utags = tags);
            } catch (e) { }
            output.ts = rtx.ts ? rtx.ts : rtx.time
            output.txid = rtx.txid
            for (const out of rtx.out) {
                if (out.e.a && out.e.a != rtx.inputAddress) {
                    pay[out.e.a] = out.e.v
                    hasPay = true
                }
            }

            if (hasPay)
                output.pay = pay
        } catch (e) {
            output.err = e.message
        }
        if (typeof output.value != "object") {
            output.err = "Invalid key transaction record. Record must be object!"
        }
        return output;
    }
    static updateKeyAndHistory(obj, key, newValue, output) {
        if (key == "todomain") return false//'todomain' is not a key
        const oldvalue = obj.keys[key];
        if (oldvalue) {
            this.parser.db.saveKeyHistory(obj, key, oldvalue);
        }
        let newKey = { value: newValue, txid: output.txid };
        if (output.ts) newKey.ts = output.ts;
        if (output.pay) newKey.pay = output.pay;
        if (output.tags) {
            newKey.tags = output.tags
            obj.tag_map[key + '.'] = output.tags;
        }
        obj.keys[key] = newKey
        return true
    }
    static async fillObj(nidObj, rtx, objMap) {
        if (nidObj.owner_key == null) {
            rtx.output.err = "No owner"
            return null
        }
        if ((nidObj.owner_key != rtx.publicKey)) { //different owner
            let authorized = false; //check admin
            rtx.output.err = "unAuthorized owner"
            for (var name in nidObj.admins) {
                var adminAddress = nidObj.admins[name];
                if (adminAddress == await Util.addressFromPublickey(rtx.publicKey)) {
                    authorized = true;
                    rtx.output.err = null;
                }
            }
            if (!authorized)
                return null;
        }
        //const ts = rtx.txTime ? rtx.txTime : rtx.time
        if (rtx.command == CMD.KEY) {
            if (rtx.output?.value?.toDomain) {
                let obj = objMap[rtx.output.value.toDomain]
                if (!obj) {
                    obj = this.parser.db.loadDomain(rtx.output.value.toDomain)
                    objMap[rtx.output.value.toDomain] = obj
                }
                if (obj && obj.status == DEF.STATUS_PUBLIC) {

                    for (const key in rtx.output.value) {
                        let newKey = key.toLowerCase()
                        let newValue = rtx.output.value[key]
                        if (CMD_KEYUSER.updateKeyAndHistory(obj, newKey, newValue, rtx.output))
                            obj.keys[newKey].fromDomain = nidObj.domain
                    }
                    obj.dirty = true
                }
            } else {
                for (const key in rtx.output.value) {
                    let newKey = key.toLowerCase()
                    let newValue = rtx.output.value[key]
                    CMD_KEYUSER.updateKeyAndHistory(nidObj, newKey, newValue, rtx.output)
                    //CMD_KEYUSER.updateKeyAndHistory(nidObj, rtx.txid, lowerKey, rtx.output.value[key], ts, rtx.output.tags, rtx.output.pay)
                }
            }

        }
        if (rtx.command == CMD.USER) {
            // Change deep merge to shallow merge.
            for (const key in rtx.output.value) {
                let lowerKey = key.toLowerCase();
                nidObj.users[lowerKey] = { value: rtx.output.value[key], txid: rtx.txid, ts: rtx.output.ts };
                nidObj.update_tx[lowerKey + '@'] = rtx.txid;
                if (rtx.output.tags) {
                    nidObj.tag_map[lowerKey + '@'] = rtx.output.tags;
                }
            }
        }
        return nidObj
    }
}

module.exports = { Parser_Domain }