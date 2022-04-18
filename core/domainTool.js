const { Util } = require('./util')
const CONSTS = require('./const')
const { CMD, DEF } = require('./def')
const Parser = require('./parser')
var axios = require("axios");
const { urlencoded } = require('body-parser');

class DomainTool {
    /**
   * Fetch NidOject from remote endpoint.
   * @param {!NidObject} domain 
   */
    static async fetchDomainAvailibility(domain) {
        try {
            domain = encodeURIComponent(domain)
            let url = `${CONSTS.nidcheck_endpoint}${domain}`;
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