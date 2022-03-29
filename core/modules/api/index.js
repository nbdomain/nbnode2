/**
 * NBDomain HTTP server for 3rd party.
 */
var url = require('url');
const { CONFIG } = require('../../config')
var express = require('express');
var bodyParser = require("body-parser");
var cors = require('cors');
const { ERR } = require('../../def')
const { Util } = require('../../util.js')
const Parser = require('../../parser')
const { json } = require('body-parser');
const fs = require("fs-extra");
const axios = require('axios');
const Nodes = require('../../nodes')
var app = express();
const { createSession } = require("better-sse");
const { bsv } = require('nbpay');
const { add } = require('bsv/lib/networks');

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }));

let indexers = null;
let bsv_resolver = null;
let ar_resolver = null;
const today = new Date();

const day = today.getDate();
const today_folder = day % 2 == 0 ? "even/" : "odd/";
const last_folder = day % 2 == 0 ? "odd/" : "even/";

const auth = async (req, res) => {
    /*try {
        const token = req.header('Authorization').replace('Bearer ', '').trim()
        req.token = token
        let authConfig = JSON.parse(fs.readFileSync(CONFIG.auth_file));
        if (!(token in authConfig.keys && authConfig.keys[token].enable == 1)) {
            throw new Error()
        }
        return true;
    } catch (error) {
        console.log(error)
        res.status(401).send({ error: 'Please authenticate!' })
    }
    return false;*/
    return true;
}

//获取访问ip
function getClientIp(req) {
    const IP =
        req.headers["x-forwarded-for"] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    return IP.split(",")[0];
}

app.get('/', async function (req, res, next) {
    if (!auth(req, res)) {
        return;
    }
    let domain = req.query['nid'];
    let f = req.query['full'] === 'true';

    if (!domain) {
        res.json({ code: ERR.NOTFOUND, message: `nid missing!` });
        return;
    }
    try {
        const ret = await indexers.resolver(Util.getchain(domain)).readDomain(domain, f);
        res.json(ret);
    } catch (err) {
        console.error(err);
        res.json({ code: 99, message: err.message });
    }
});
async function getAllItems(para, forceFull = false, from = null) {
    //check ,
    let items = []
    const domains = para.split(',')

    domains.forEach(domain => {
        const his = domain.split('/') //check '/'
        if (his.length == 1) items.push(domain)
        else {
            const moreHis = his[1].split('-') //check '-'
            if (moreHis.length == 1) {
                if (his[1] == 'all') {
                    const resolver = indexers.resolver(Util.getchain(his[0]))
                    const count = resolver.getDomainHistoryLen(his[0])
                    for (let i = 1; i <= count; i++) {
                        items.push(his[0] + "/" + i)
                    }
                    items.push(his[0])
                } else items.push(domain)
            }
            else {
                for (let i = +moreHis[0]; i <= +moreHis[1]; i++) {
                    items.push(his[0] + "/" + i)
                }
            }
        }
    })
    let ret = []
    for (const item of items) {
        if (item === '') continue;
        const dd = item.split('/')
        const resolver = indexers.resolver(Util.getchain(dd[0]))
        if(!resolver) continue;
        const result = await resolver.readDomain(dd[0], forceFull, dd[1])
        if (from && result.obj.ts <= from) continue
        ret.push(result)
    }
    return ret
}
app.get('/q/*', async function (req, res) {
    const para = req.params[0]
    const from = req.query['from']
    const ret = await getAllItems(para, false, +from)
    res.json(ret)
})
app.get('/qf/*', async function (req, res) {
    const para = req.params[0]
    const from = req.query['from']
    const ret = await getAllItems(para, true, from)
    res.json(ret)
})
app.get('/t/addtx/:txid', (req, res) => {
    const txid = req.params['txid']
    const chain = req.query['chain']
    if(!chain)chain='bsv'
    const indexer = indexers.get(chain)
    if(indexer)indexer.add(txid)
})
app.get('/address/:address/balance', async function (req, res) {
    const address = req.params['address']
    const url = `https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`;
    try{
        const json = (await axios.get(url)).data;
        res.json(json);
    }catch(e){
        res.json({confirmed:0})
    }
})
app.get('/util/verify', async function (req, res) {
    try {
        const domain = req.query['domain']
        let publicKey = req.query['publicKey']
        const strSig = req.query['sig']
        const data = req.query['data']
        if (domain) {
            const ret = await bsv_resolver.readDomain(domain, false)
            if (ret.code != 0) {
                res.json({ code: -1, message: ret.message })
                return
            }
            publicKey = ret.obj.owner_key
        }

        let sig = bsv.crypto.Signature.fromString(strSig)
        let pubKey = bsv.PublicKey.fromString(publicKey)
        let hash2 = bsv.crypto.Hash.sha256(bsv.deps.Buffer.from(data, 'hex'))
        res.json({ code: bsv.crypto.ECDSA.verify(hash2, sig, pubKey) ? 0 : -1 })

    } catch (e) {
        res.json({ code: -1, message: e.message })
    }
})
app.post('/postTx',async (req,res)=>{
    const obj = req.body;
    let chain = 'bsv'
    if (obj.chain == 'ar') chain = 'ar'
    ret = await Util.sendRawtx(obj.rawtx, chain);
    res.json(ret)
})
app.post('/sendTx', async function (req, res) {
    const obj = req.body;
    let chain = 'bsv'
    if (obj.chain == 'ar') chain = 'ar'
    console.log("got obj:",obj)
    let ret = await (Parser.getParser(chain).parseRaw({ rawtx: obj.rawtx, height: -1, verify: true }));
    if (ret.code != 0 || !ret.obj.output || ret.obj.output.err) {
        res.json({ code: -1, message: ret.msg })
        return
    }
    ret = await Util.sendRawtx(obj.rawtx, chain);
    if (ret.code == 0) {
        indexers.get(chain)._onMempoolTransaction(ret.txid, obj.rawtx)
        /*if(chain=='ar'){
            indexers.ar._onMempoolTransaction(ret.txid,obj.rawtx)
        }else
            indexers.bsv._onMempoolTransaction(ret.txid,obj.rawtx)*/
        Nodes.notifyPeers({ cmd: "newtx", data: JSON.stringify({ txid: ret.txid, chain: chain }) })
    }
    res.json(ret);
});
async function handleNewTx(para, from) {
    let db = bsv_resolver.db, indexer = indexers.bsv;
    if (para.chain == "ar") {
        db = ar_resolver.db
        indexer = indexers.ar
    }
    const chain = para.chain?para.chain:'bsv'
    if (!db.hasTransaction(para.txid,chain)) {
        const url = from + "/api/p2p/gettx?txid=" + para.txid + "&chain=" + chain
        const res = await axios.get(url)
        if (res.data) {
            indexer._onMempoolTransaction(para.txid, res.data.rawtx)
        }
    }
}
function save_pr(body, isNotify) {
    var data = JSON.stringify(body);
    var id = body.id;
    let dir = __dirname + "/tx/";
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    dir += today_folder;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    let filename = dir + id;
    if (isNotify) filename += ".no";

    console.log("save relay data:" + data)
    var ret = fs.writeFileSync(filename, data);

    fs.remove(__dirname + "/tx/" + last_folder);
}
app.post('/relay/save', (req, res) => {
    const IP = getClientIp(req);
    console.log("Save relay IP:", IP);
    save_pr(req.body, false);
    res.send({ err: 0 });
})
function get_pr(id, isNotify) {
    let filename = __dirname + "/tx/" + today_folder + id;
    //log(id);
    if (isNotify) filename += ".no";
    try {
        let data = fs.readFileSync(filename);
        return data;
    } catch (e) {
        //log(e.message);
    }
    return null;
}
app.get('/relay/get/:id', (req, res) => {
    const notify = req.query.notify ? true : false;
    let id = req.params['id'];
    let data = get_pr(id, notify);
    if (data) {
        res.end(data);
        return;
    }
    res.end("404");
})

app.post('/relay/notify', async (req, res) => {
    const result = req.body;
    console.log("got notify,result=",result);
    save_pr(req.body, true);
    if (result.ack_url) res.end("200");
    else res.json({ code: 0, message: "ok" });
})
app.get('/nodes',(_,res)=>{
    res.json(Nodes.getNodes())
})
app.get('/sub/:domain/', async (req, res) => {
    const domain = req.params['domain']
    const session = await createSession(req, res);
    let db = bsv_resolver.db;
    if (domain.indexOf('.a') != -1) {
        db = ar_resolver.db
    }
    db.subscribe(domain, session)
    req.on("close", () => {
        res.end()
        console.log("one sub closed")
    })
})
app.get('/p2p/:cmd/', function (req, res) { //sever to server command
    const cmd = req.params['cmd']
    let ret = { code: 0 }
    console.log("get p2p cmd:", cmd, " params:", req.query)
    if (cmd === 'ping') {
        if (req.query['sign']) {

        }
        ret.msg = "pong";
    }
    if (cmd === "newtx") {
        const d = req.query['data'];
        const para = JSON.parse(d)
        const from = req.query['from']
        handleNewTx(para, from)
    }
    if (cmd === 'gettx') {
        let indexer = indexers.bsv
        if (req.query['chain'] == 'ar') indexer = indexers.ar
        ret.rawtx = indexer.rawtx(req.query['txid'])
        if (!ret.rawtx) {
            ret.code = 1; ret.msg = 'not found';
        }
    }
    res.json(ret)
})
app.get('/queryKeys', function (req, res) {
    const num = req.query['num'] ? req.query['num'] : 50;
    const startID = req.query['startID'] ? req.query['startID'] : 0;
    const tags = req.query['tags'] ? req.query['tags'] : null;
    const includeHistory = req.query['includeHistory'] ? req.query['includeHistory'] : 0;
    const result = bsv_resolver.db.queryKeys({ v: 1, num: num, startID: startID, tags: tags });
    if (includeHistory == 0) {
        result.data = result.data.filter(item => item.key.indexOf('/') == -1)
    }
    res.json(result);
    return;
});
app.get('/queryTags', function (req, res) {
    const exp = req.query['exp'];
    const result = bsv_resolver.db.queryTags(exp ? exp : null);
    res.json(result);
    return;
});
app.get('/nodeInfo', (req, res) => {
    let info = CONFIG.node_info;
    info.endpoints = Object.keys(CONFIG.proxy_map);
    info.version = "1.5.1";
    info.tld = CONFIG.tld_config
    res.json(info);
})
app.get(`/tld`, function (req, res) {
    if (!auth(req, res)) {
        return;
    }
    res.json(CONFIG.tld_config);
});
app.get('/queryTX', (req, res) => {
    const fromTime = req.query['from']
    const toTime = req.query['to']
    const chain = req.query['chain']
    const resolver = indexers.get(chain).resolver
    res.json(resolver.readNBTX(fromTime ? fromTime : 0, toTime ? toTime : -1))
})
app.get('/test', async (req, res) => {
/*    let sql = "select * from ar_tx"
    const ret = indexers.db.txdb.prepare(sql).all()
    console.log(ret)
    console.log("count:",ret.length)
    res.end("ok")*/
    const rawtx = "010000000174c4ef25dc0abe9f25562be06fc355815ca4a4b8bd6641efc677634a08f9ffed010000006a473044022009d62c586d19600cd6428845339fd43854f809c4fd0c8b1a17b1f697333fc2f30220681700a83c45e64a63c73608ab1253cd5aabbf521a85ac7bdae7d049bc1197be412103db962c1b31ecd6051f76b67683515d3f988de926b1434897d87f3c7884bcb3e4ffffffff040000000000000000fd3109006a036e62641f7b5c22765c223a322c5c2274735c223a5c22313634383534333635345c227d223134504d4c31587a5a7173354a764a43477932414a325a41517a5445626e4336735a06313036363433036b65794dda087b5c225f70726f66696c655c223a7b5c226176617461725c223a5c22646174613a696d6167652f706e673b6261736536342c6956424f5277304b47676f414141414e53556845556741414142734141414162434159414141434e315052564141414141584e535230494172733463365141414145526c57456c6d545530414b674141414167414159647041415141414141424141414147674141414141414136414241414d414141414241414541414b4143414151414141414241414141473641444141514141414142414141414777414141414432443154354141414634306c4551565249446156572b573956525267394d2f632b75714546697252514547785a5330485a5a536d795177544b4b675a455159314b53507a4678502f454830424d544351516c38514551516949514e6d4b554d7065466845454d56594b705a566967623437342f6c6d33727674613469592b43557a3739365a627a317a376a635039374d443634666d4c30654f663239392f78306233666a5669706a6d4a76767734342f38586b354b522f53654e484b357a744843306270386b593171547a6f664d6d6c30467474356f664f3736727a6733743171707931545534506f3845476774645870684942344679305a38767a55614e5478457053565134305941615862633035376378704b5165586e777a3538434a575441775954536173776f4f4c7a6634676e71656b70553542592f794655364e326b7a5751764667615251434b705950475766386a517a7479544c5846712b6143366459642b6f5152494a4a7a53763569356652644d6a4653504868374a6c4a6e713159735a6579664543617167414c716b314f2f5371323235443976364e3878764e2b504b334b5a4d68412f50356a7349335a7131734d334e554d4c416345456c676b574c6f594a414e4e322b4b696d424c68384a6c5a6348744c55684f6e63573976496c74796454644f776f7a4c56666f487633495a365a4e616e43336767574c455177626f4c546c34536948643852526d61686835636a3866717147493759592f71424d41576a787741794f6b693062792f614f444a434559316738564b4575557853684f52776568732b5154754e2f4e622f6e7657516f516758566b495048754a386d66506e574e5532324f7658685341573573706c4a4c647649313045526f6f4f6f49634f67783434794c3854526b4d497a6257722f70317a5646734450486951555a58712b5277444c554a514d6332685a42747549376c7a42387978617342456e6f33526b554f7756362b346778576d36614c65434e39624677657a6a7834682b634e754a4c2f634567644455785073765562334c6a59714f78764239426d4563416c55595346416d366a71414b4a644f32493956715a6747786f514d597559484155396f62703362336373543366767774625677544a4445546b6e4353496933356d654d424868366a585177345a7a77374c796b79343563366e4f4b334875634761705979596a7853434e755850477250576f3056426c6445526865716c66506d646c51552b636a4d53363951676d546546526844412f383169326649486f794548435a774168533438436842307a46412b61454f69794d6e3558505a31444e394642384d6f304a456a68746f334e734464762b4431683662515a434e6c46676f6d543644545856535739554a6557497648426569624437704754445754483761726472784a69534155642b70337375734e6676417a327a33713062646c4d574f3834492f33534b4953544b2b6a517479525a31494d475177306f595a74696b455158476e7655644270335a356b6739677a5545554b337a6a4f5163314144426942637552726872446d2b43724c5531746644386a786a4563654554526f77756d54355a62476e5a5052473362636667704576736e55566544684567386243526e756e7754464f476b4334356d322b33796262716d444f6e305879363631517858324278342f64734b6c6679506e54587a42326e45756750526a78317a7867595a55593265596d67496576387276782f52484d6f537167367a4d4935374d4e6a58385a64753237705051396d45735830625a7067362b43657335576775586c45643670726a737859306d37765449396343444332584e64467a66587238486575736e766244416777536a6d5968304d71394f38772b5477672b6d7a2f4a726f6b6a6769417061346c5371442b5a564976504757713077594b76335656615a79633267384538466b6f573441632b61556336424c557831454842464b6332412f6f74466a6f59754c5061556a306a7031486c52786c3668696d777058724553346249572f4a65514d6f7768527a516b4734374d754834474156616b2b7862434e684f5a304c612b514672475052544b5743714c6475317932516f786f7a793541344b5a445961766d325953565378444d6d63637555755274705247665049486b707876346e6645754332624f3458557733686d5a697863516e617146377664384843682b344163614854384774576b6a3750322f434f4d464b4c59325057597355616c775177387263325151473876504939722f49354a624e384e554830556f4e3632775252686f483751672b716d6144447648595032704c76566b696a684937747a7537724667336e7766524967316846302b68782b31434b4756633039752b7862524e312b35704a424d457359324d6f394478463048566675424f2f3644645975644a676d7673726f676d4457627658437462395a735a37487739685a6b6b677a696d764476743979574b6970434b426d594d366468523431784a527332554745563030734e392b4b6e644b4747653253706b6c7336465568516359773965686a52336a324f454344554971705849594b6c72374579336b6c474d736e72796d4437534a44474a34446e5936566e2b63436a37776e6c63424b725971712f3634346359754d395446394d31694844684951347a2f644875485135776c5676497054385857565359663066615839502f545631353548382f444f593439582b2f346b77754448647468694554566e7a623053776849486d767571432f674e71323273376b7166762f7741414141424a52553545726b4a6767673d3d5c227d7d0000000000000000fd0001006a2231346b7871597633656d48477766386d36596753594c516b4743766e395172677239423033646239363263316233316563643630353166373662363736383335313564336639383864653932366231343334383937643837663363373838346263623365344c9633303434303232303232306436656639313531343563353563613961646338386136323237333264353966326234613139343232326433316437643236376639376132303935626530323230376137393861643166323338363462323532343934656462363934633538663236643663616365396564333866313630353464636563326130643136383131372020202020202020202072040000000000001976a9147778b6562f5974ca6f7e7a4ca8bdc2d85803c3e488aca7ab0000000000001976a9140eacfc63724377321b7ecc6d74fb6b70d85964f588ac00000000"
    let ret = await (Parser.getParser('bsv').parseRaw({ rawtx: rawtx, height: -1, verify: true }));
})
app.get('/find_domain',(req,res)=>{
    var addr = req.query.address;
    let result = bsv_resolver.db.queryDomains(addr);
    const arr = []
    result.forEach(item=>{
        const dd = item.domain.split('.')
        arr.push({nid:dd[0],tld:dd[1],domain:item.domain})
    })
    
    res.json({
        code: 0,
        message: "OK",
        obj: arr
    })

})
app.get(`/findDomain`, function (req, res) {
    try {
        var addr = req.query.address;
        let result = bsv_resolver.db.queryDomains(addr);
        res.json({
            code: 0,
            message: "OK",
            obj: result
        })
    } catch (err) {
        let resp = {
            code: 99,
            message: err.message
        };
        console.log(err);
        res.json(resp);
        return;
    }
});

//-----------------------Blockchain tools---------------------------------//
app.get('/tools/:chain/balance/:address',async (req,res)=>{
    const address = req.params['address']
    const chain = req.params['chain']
    let addr = Util.parseJson(address)
    if(!addr) addr = address
    const ret = await Util.getBalance(addr,chain)
    res.json(ret)
})
app.get('/tools/:chain/status/:txid',async (req,res)=>{
    const txid = req.params['txid']
    const chain = req.params['chain']
    const ret = await Util.getTxStatus(txid,chain)
    res.json(ret)
})

module.exports = function (env) {
    indexers = env.indexers;
    bsv_resolver = indexers.bsv ? indexers.bsv.resolver : null;
    ar_resolver = indexers.ar ? indexers.ar.resolver : null
    return new Promise((resolve) => {
        const server = app.listen(0, function () {
            const port = server.address().port;
            console.log(`API server started on port ${port}...`)
            resolve(port);
        })
    })
}