

const fs = require("fs");
const url = require("url");
const axios = require("axios");
const punCode = require('punycode');
//const bitfs = require("./bitfs.js");
const ipfs = require("./ipfs.js");

class nbweb_mgr {
  async init(env) {
    //console.log(env);
    this.env = env;
  }
  output_md(res, jsonReturn) {
    let text_template = fs.readFileSync(__dirname + "/template/text.html").toString();
    let text = text_template.replace("NIDOBJ", JSON.stringify(jsonReturn));
    let url = `http://${this.env.server.domain}:${this.env.server.port}`
    if (this.env.server.https) {
      url = `https://${this.env.server.domain}`
    }
    text = text.replace("nb://", url);
    //console.log(text);
    res.send(text);
  }
  async outputFromBitfs(res, path) {

    return false;
  }
  async readDomain(domain) {
    const url = "http://localhost:" + this.env.server.port + "/api/?nid=" + domain;
    try {
      return (await axios.get(url)).data;
    } catch (e) {
      console.log(e.message);
      return null
    }
  }
  async handleURL(req, res, addr) {
    addr = "https://" + addr;
    let q = url.parse(addr, true);
    //console.log(q);
    //let res_content = await reader.read_domain(q.hostname);
    //console.log(res_content);
    let hostname = punCode.toUnicode(q.hostname); //support unicode name
    console.log(hostname);
    const dots = hostname.split('.').length - 1;
    if (dots == 1) hostname = "*." + hostname;
    //hostname = encodeURI(hostname);
    let res_content = await this.readDomain(hostname);
    //console.log(res_content);
    if (res_content != null) {
      if (res_content.code == 0) {

        let obj = {};
        try {
          obj = JSON.parse(res_content.obj.value);
        } catch (e) {
          this.output_md(res, res_content.obj.value)
          return;
        }

        //console.log(obj)
        if (obj.t == "web") {
          await this._handle_data(req, res, obj, q);
          return;
        } else {
          this.output_md(res, res_content)
          return
        }


      } else {
        if (res_content.code != 102) {
          const domain = q.hostname.split('.');
          const redirectUrl = "https://www.nbdomain.com/#/search?nid=" + domain[0];
          res.redirect(redirectUrl);
        }
        else {
          res.send("No website at: " + q.hostname + " <p><a href='https://www.nbdomain.com'>Manage</a>");
        }
        //res.sendFile(__dirname + "/template/welcome.html");
        return;
      }
    } else {
      res.sendFile(__dirname + "/template/welcome.html");
      return;
    }
  }
  _parse_data(data) {
    // data = data.replace(/bitfs:\/\//gi, "/bitfs/");
    // data = data.replace(/ipfs:\/\//gi, "/ipfs/");
    return data;
  }
  async _handle_data(req, res, obj, q) {
    console.log(q.path);
    if (obj.format.toLowerCase() == "ipfs") {
      await ipfs.handle_Data(req, res, obj, q.path);
      return;
    }
    let handled = false;
    if (obj.format.toLowerCase() == "urlmap") {
      let staticsMap = obj.statics[q.path];
      console.log(staticsMap);
      if (staticsMap != undefined) {
        if (staticsMap.url.indexOf("bitfs:") == 0) { //bitfs protocol
          let bit = new bitfs;
          handled = await outputFromBitfs(res, staticsMap);
        } else if (staticsMap.url.indexOf("base64:") == 0) { //base64 encoded

        } else {
          const data = staticsMap.data;
          if (data) {
            res.end(data);
            handled = true;
          }
        }
      }
      if (!handled) {
        res.end("404");
      }

      /*    let map_url = obj.urlmap[q.path];
          
          if(!map_url){ 
            map_url = obj.urlmap['/']+q.path;
          }
          console.log(map_url);
          if (map_url != undefined) {
            if (map_url.indexOf("/bitfs/") == 0) { //bitfs protocol
              let bit = new bitfs;
              let handled = await bitfs.handle_Data(res, map_url.slice(6));
              if (handled == false) {
                res.end("bitfs not found");
              }
              return;
            }
            if (map_url.indexOf("/ipfs/") == 0) { //ipfs protocol
              console.log("got ipfs url:"+map_url);
              //res.writeHead(302, {'Location': map_url+'/'});
              //res.end();
              await ipfs.handle_Data(res,map_url.slice(6));
              return;
            }
            return;
          }*/

      res.end("404");
    }
  }
}

module.exports = new nbweb_mgr();
