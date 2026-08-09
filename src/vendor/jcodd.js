// ─────────────────────────────────────────────────────────────────────────────
// [벤더링] jcodd v0.9.1 — JSON Characterized Object Data Definition
// 원본: npm 패키지 jcodd (https://github.com/Esterkxz/JCODD, MIT).
// 원본 코드 무수정 복사이며, 이 헤더 블록과 파일
// 맨 끝의 ESM export 한 줄만 추가됐다 (classic .js 라 ESM export 가 없음).
// 갱신 시 npm 원본으로 본문을 통째로 교체하고 이 두 추가분만 유지할 것.
// ─────────────────────────────────────────────────────────────────────────────

/*

MIT License

Copyright (c) 2023 Esterkxz (Ester1 / 에스터1z)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

     

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// JSON Characterized Object Data Definition //
//
// The JSON based lite code format
//
// v0.9.1 / release 2026.04.18
//
// Take to be liten from JSON code to smaller converted characters for like as BASE64.
//
// And JCODD code output is only one exactly from any defined by same object structure & data.
// Be excepted when different version of JCODD.
//
//
// :: Code regulations
//
// 1. null is n, true is t, false is f.
// 2. No space and carriage return & line feed in the code. Only allowed for data definition.
// 3. Omit "" (double quote) for variable name definition.
// 4. Unicode characters is escaped with %uXXXX or %XX format.
// 5. Single quote ' is not allowed in value of JCODD code when code is fallback(using ' instead " for value container) type.

class Jcodd {

    /**
     * Base64 encode with Node.js fallback
     * 
     * @param {string} str 
     * 
     * @returns {string} base64 encoded string
     */
    static base64Encode(str) {
        return typeof btoa !== 'undefined' ? btoa(str) : Buffer.from(str, 'utf8').toString('base64');
    }

    /**
     * Base64 decode with Node.js fallback
     * 
     * @param {string} str 
     * 
     * @returns {string} base64 decoded string
     */
    static base64Decode(str) {
        return typeof atob !== 'undefined' ? atob(str) : Buffer.from(str, 'base64').toString('utf8');
    }

    /**
     * Characterize JSON
     * 
     * @param {string} json 
     * 
     * @returns {string} jcodd
     */
    static toCodd(json) {
        switch (json) {
            case "true": return "t";
            case "false": return "f";
            case "null": return "n";
        }
        var ex;
        //Get clean json
        let p1 = JSON.stringify(JSON.parse(json));
        //Convert null to n
        let p2 = p1.replace(/([\[\,\:])null([\]\,\}])/g, "$1n$2").replace(/([\[\,\:])null([\]\,\}])/g, "$1n$2");
        //Convert true to t
        let p3 = p2.replace(/([\[\,\:])true([\]\,\}])/g, "$1t$2").replace(/([\[\,\:])true([\]\,\}])/g, "$1t$2");
        //Convert false to f
        let p4 = p3.replace(/([\[\,\:])false([\]\,\}])/g, "$1f$2").replace(/([\[\,\:])false([\]\,\}])/g, "$1f$2");
        //Remove ""
        let p5 = p4.replace(/([\{\,])\"([^\"]*)\"\:/g, "$1$2:");
        //Check convert unicode
        if (p5.match(/[\u0000-\u001F|\u0080-\uFFFF]/g) != null) {
            let p6 = this.escape(p5);
            ex = p6;
        } else ex = p5;

        // console.log(p1);
        // console.log(p2);
        // console.log(p3);
        // console.log(ex);

        return ex;
    }

    /**
     * Convert object to JCODD directly
     * 
     * @param {object} obj 
     * 
     * @returns {string} JCODD
     */
    static coddify(obj) {
        let json = JSON.stringify(obj);

        return this.toCodd(json);
    }

    /**
     * Parse JCODD to JSON
     * 
     * @param {string} codd 
     * 
     * @return {string} json
     */
    static toJson(codd, allowFallback = false) {
        switch (codd) {
            case "t": return "true";
            case "f": return "false";
            case "n": return "null";
        }
        //unescape
        let p1 = this.unescape(codd);//unescape(codd);//=> deprecated
        //Replace ' to " (fallback)
        if (p1.startsWith("'") && p1.endsWith("'")) p1 = '"' + p1.slice(1, -1) + '"';
        else if (allowFallback) {
            const fallbackRegex = /([\,\[\:])\'([^\']*)\'([\,\]\}])/g;
            if (fallbackRegex.test(p1)) p1 = p1.replace(fallbackRegex, '$1"$2"$3').replace(fallbackRegex, '$1"$2"$3');
        }
        //Assign property names with ""
        let p2 = p1.replace(/(\{|\}\,|\]\,|\"\,|[eE]?[+\-]?[\d.]+\,|[ntf]\,|true\,|false\,)([^\"\{\}\[\]\,\:]*)\:/g, '$1"$2":');
        //Convert n to null
        const nullRegex = /([\[\,\:])n([\]\,\}])/g;
        let p3 = p2.replace(nullRegex, "$1null$2").replace(nullRegex, "$1null$2");
        //Convert t to true
        const trueRegex = /([\[\,\:])t([\]\,\}])/g;
        let p4 = p3.replace(trueRegex, "$1true$2").replace(trueRegex, "$1true$2");
        //Convert f to false
        const falseRegex = /([\[\,\:])f([\]\,\}])/g;
        let p5 = p4.replace(falseRegex, "$1false$2").replace(falseRegex, "$1false$2");

        return p5;
    }

    /**
     * Convert JCODD to object directly
     * 
     * @param {string} codd 
     * 
     * @returns {*} object
     */
    static parse(codd, allowFallback = true) {
        let json = this.toJson(codd, false);

        try {
            return JSON.parse(json);
        } catch (e) {
            if (allowFallback) {
                // try fallback
                json = this.toJson(codd, true);
                
                try {
                    return JSON.parse(json);
                } catch (ef) {
                    throw e;
                }
            } else throw e;
        }
    }

    /**
     * Return to be escaped unicode character from char code
     * 
     * @param {Integer} cc  Char Code
     * 
     * @returns {String} unescaped
     */
    static esc(cc) {
        if (cc < 0x20 || cc > 0x7e) {
            let x16 = cc.toString(16);
            var ex;
            if (x16.length > 2) ex = "%u" + x16.padStart(4, '0').toUpperCase();
            else ex = "%" + x16.padStart(2, '0').toUpperCase();
            return ex;
        } else return String.fromCharCode(cc);
    }

    /**
     * Return to be escaped unicode characters in string
     * 
     * @param {String} str
     * 
     * @returns {String} unescaped
     */
    static escape(str) {
        var escaped = "";
        for (var i = 0; i < str.length; i++) {
            escaped += this.esc(str.charCodeAt(i));
        }
        return escaped;
    }

    /**
     * Return to be unescaped unicode characters in string
     * 
     * @param {String} str
     * 
     * @returns {String} escaped
     */
    static unescape(str) {
        return str.replace(/%u([\dA-F]{4})/gi, (match, block) =>
            String.fromCharCode(parseInt(block, 16))
        );
    }


    #obj;
    get obj() { return this.#obj; }
    get json() { return JSON.stringify(this.#obj); }
    get jcodd() { return Jcodd.coddify(this.#obj); }
    get base64() { return Jcodd.base64Encode(this.jcodd); }
    get code() { return this.jcodd; }

    /**
     * Quick set object and get converted to any data type
     * @param {*} any BASE64 orJCODD or JSON or object or primitive
     */
    constructor(any) {
        if (typeof any == "string") try {
            any = Jcodd.parse(any);
        } catch (e) {
            try {
                any = Jcodd.parse(Jcodd.base64Decode(any));
            } catch (e) {
                // do nothing
            }
        }
        this.#obj = any;
    }

    toString() {
        return this.code;
    }

}

const JCODD = any => new Jcodd(any);

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = JCODD;
    module.exports.Jcodd = Jcodd;
}

// [벤더링 추가분 — 유일한 수정] ESM export (원본은 CJS 가드뿐)
export { Jcodd, JCODD };
