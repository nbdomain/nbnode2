const CONSTS = require('./const')
const { NBLib, Util } = require('./Util')
var axios = require("axios");

class DomainTool {
    /**
   * Fetch NidOject from remote endpoint.
   * @param {!NidObject} domain 
   */
    static async fetchDomainPrice(domain, newTx = false) {
        try {
            await Util.initNBLib()
            const key = domain + ".prices.nbinfo.b"
            const r = await NBLib.readDomain(key)
            if (r.code == 0) {
                return { code: 0, price: r.obj.value.price }
            }
            domain = encodeURIComponent(domain)
            let url = `${CONSTS.nidcheck_endpoint}${domain}?prereg=${newTx}`;
            console.log(`Sending request to URL ${url}`);
            let res = await axios.get(url, { timeout: 10000 });
            return res.data;
        } catch (error) {
            console.log(error);
            return { code: -1000, message: error };
        }
    }

}

// ------------------------------------------------------------------------------------------------

module.exports = {
    DomainTool
}