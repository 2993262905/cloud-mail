import app from '../hono/hono';
import result from '../model/result';
import verifyCodeService from '../service/verify-code-service';

app.post('/public/sendVerifyCode', async (c) => {
	const data = await verifyCodeService.sendCode(c, await c.req.json());
	return c.json(result.ok(data));
});

app.post('/public/verifyCode', async (c) => {
	const data = await verifyCodeService.verifyCode(c, await c.req.json());
	return c.json(result.ok(data));
});
