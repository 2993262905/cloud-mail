import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';
import verifyUtils from '../utils/verify-utils';
import settingService from './setting-service';
import emailService from './email-service';
import reqUtils from '../utils/req-utils';

const CODE_TTL = 600;
const SEND_COOLDOWN = 60;
const HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const SENDER_DOMAIN = '299326.xyz';
const SENDER_EMAIL = 'verify@299326.xyz';
const SENDER_NAME = '锈蚀死域';

function normalizeEmail(email) {
return String(email || '').trim().toLowerCase();
}

function normalizePurpose(purpose) {
const value = String(purpose || 'rdz-register').trim();
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) {
throw new BizError('purpose 不合法');
}
return value;
}

function genCode() {
const buf = new Uint32Array(1);
crypto.getRandomValues(buf);
return String(100000 + (buf[0] % 900000));
}

function hourBucket() {
const now = new Date();
return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

async function getCount(c, key) {
const raw = await c.env.kv.get(key);
return raw? parseInt(raw, 10) || 0: 0;
}

async function incrWithTtl(c, key, ttl) {
const count = (await getCount(c, key)) + 1;
await c.env.kv.put(key, String(count), { expirationTtl: ttl});
return count;
}

const verifyCodeService = {

async sendCode(c, params) {
const email = normalizeEmail(params.email);
const purpose = normalizePurpose(params.purpose);

if (!verifyUtils.isEmail(email)) {
throw new BizError('邮箱格式不对');
}

const codeKey = `${KvConst.VERIFY_CODE}${purpose}:${email}`;
const cooldownKey = `${KvConst.VERIFY_SEND}${purpose}:${email}`;
const hourKey = `${KvConst.VERIFY_HOUR}${purpose}:${email}:${hourBucket()}`;
const ip = reqUtils.getIp(c);
const ipHourKey = `${KvConst.VERIFY_IP_HOUR}${ip}:${hourBucket()}`;

const lastSent = await c.env.kv.get(cooldownKey);
if (lastSent && Date.now() - parseInt(lastSent, 10) < SEND_COOLDOWN * 1000) {
throw new BizError('发得太快了，60 秒后再试');
}

if ((await getCount(c, hourKey)) >= HOURLY_LIMIT) {
throw new BizError('这个邮箱一小时最多发 5 次');
}

if ((await getCount(c, ipHourKey)) >= IP_HOURLY_LIMIT) {
throw new BizError('这个 IP 一小时发得太多了');
}

const { resendTokens} = await settingService.query(c);
const resendToken = resendTokens && resendTokens[SENDER_DOMAIN];
if (!resendToken) {
throw new BizError('发信服务未配置');
}

const code = genCode();
const expiresAt = Date.now() + CODE_TTL * 1000;

await c.env.kv.put(codeKey, JSON.stringify({ code, expiresAt}), { expirationTtl: CODE_TTL});
await c.env.kv.put(cooldownKey, String(Date.now()), { expirationTtl: SEND_COOLDOWN});
await incrWithTtl(c, hourKey, 3600);
await incrWithTtl(c, ipHourKey, 3600);

const subject = `邮箱验证码：${code}`;
const text = `你的邮箱验证码是 ${code}，10 分钟内有效，请勿泄露。`;
const html = `<p>你的邮箱验证码是</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>10 分钟内有效，请勿泄露。</p>`;

await emailService.sendByResend(resendToken, {
name: SENDER_NAME,
accountEmail: SENDER_EMAIL,
receiveEmail: [email],
subject,
text,
html,
attachments: []
});

return { expiresIn: CODE_TTL};
},

async verifyCode(c, params) {
const email = normalizeEmail(params.email);
const purpose = normalizePurpose(params.purpose);
const code = String(params.code || '').trim();

if (!verifyUtils.isEmail(email)) {
throw new BizError('邮箱格式不对');
}

if (!/^\d{6}$/.test(code)) {
throw new BizError('验证码是 6 位数字');
}

const codeKey = `${KvConst.VERIFY_CODE}${purpose}:${email}`;
const raw = await c.env.kv.get(codeKey);
if (!raw) {
throw new BizError('验证码已过期或未发送');
}

let stored;
try {
stored = JSON.parse(raw);
} catch (e) {
await c.env.kv.delete(codeKey);
throw new BizError('验证码已过期或未发送');
}

if (Date.now() > stored.expiresAt) {
await c.env.kv.delete(codeKey);
throw new BizError('验证码已过期');
}

if (stored.code!== code) {
throw new BizError('验证码错误');
}

await c.env.kv.delete(codeKey);
return { verified: true};
}

};

export default verifyCodeService;
