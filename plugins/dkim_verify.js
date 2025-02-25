
const dkim = require('./dkim');

const DKIMVerifyStream = dkim.DKIMVerifyStream;

const plugin = exports;

dkim.DKIMObject.prototype.debug = str => {
    plugin.logdebug(str);
}

DKIMVerifyStream.prototype.debug = str => {
    plugin.logdebug(str);
}

exports.register = function () {
    this.load_config()
}

exports.load_config = function () {
    const cfg = this.config.get('dkim_verify.ini', {}, () => this.load_config())

    this.cfg = Object.assign({}, cfg.main, {
        timeout: plugin.timeout ? plugin.timeout - 1 : 0
    })
}

exports.hook_data_post = function (next, connection) {
    const self = this;
    const txn = connection.transaction;
    const verifier = new DKIMVerifyStream(this.cfg, (err, result, results) => {
        if (err) {
            txn.results.add(self, { err });
            return next();
        }
        if (!results || results.length === 0) {
            txn.results.add(self, { skip: 'no/bad dkim signature' });
            return next(CONT, 'no/bad signature')
        }
        results.forEach((res) => {
            let res_err = '';
            if (res.error) res_err = ` (${res.error})`;
            connection.auth_results(`dkim=${res.result}${res_err} header.i=${res.identity} header.d=${res.domain} header.s=${res.selector}`);
            connection.loginfo(self, `identity="${res.identity}" domain="${res.domain}" selector="${res.selector}" result=${res.result} ${res_err}`);

            // save to ResultStore
            const rs_obj = JSON.parse(JSON.stringify(res));
            if      (res.result === 'pass') { rs_obj.pass = res.domain; }
            else if (res.result === 'fail') { rs_obj.fail = res.domain + res_err; }
            else                            { rs_obj.err  = res.domain + res_err; }
            txn.results.add(self, rs_obj);
        });

        connection.logdebug(self, JSON.stringify(results));
        // Store results for other plugins
        txn.notes.dkim_results = results;
        next();
    })

    txn.message_stream.pipe(verifier, { line_endings: '\r\n' });
}
