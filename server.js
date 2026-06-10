const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = '4848281438121790';
const CLIENT_SECRET = 'X1jZh2eHy6kCuiLX9y4uW7RL0zRN5qTE';

app.post('/auth/token', async (req, res) => {
  const { code, refresh_token, grant_type } = req.body;
  try {
    const body = new URLSearchParams({
      grant_type: grant_type || 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...(code ? { code, redirect_uri: 'https://httpbin.org/get' } : {}),
      ...(refresh_token ? { refresh_token } : {})
    });
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    const r = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/vendas/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { userId } = req.params;
  const dias = req.query.dias || 30;
  const dataFrom = new Date();
  dataFrom.setDate(dataFrom.getDate() - dias);
  const dataFromStr = dataFrom.toISOString().split('.')[0] + '.000-03:00';
  try {
    let todas = [];
    let offset = 0;
    let total = 1;
    while (offset < total && offset < 200) {
      const r = await fetch(
        `https://api.mercadolibre.com/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${dataFromStr}&limit=50&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json();
      total = data.paging?.total || 0;
      todas = todas.concat(data.results || []);
      offset += 50;
    }
    const vendasPorSku = {};
    todas.forEach(o => {
      o.order_items?.forEach(item => {
        const sku = item.item?.seller_sku || item.item?.id || 'SEM_SKU';
        vendasPorSku[sku] = (vendasPorSku[sku] || 0) + (item.quantity || 0);
      });
    });
    res.json({ total_pedidos: todas.length, dias, vendas_por_sku: vendasPorSku });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/estoque-full/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { userId } = req.params;
  try {
    const r = await fetch(
      `https://api.mercadolibre.com/users/${userId}/items/search?limit=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    const itemIds = data.results || [];
    if (!itemIds.length) return res.json({ estoque: {} });
    const estoqueMap = {};
    for (let i = 0; i < itemIds.length; i += 20) {
      const chunk = itemIds.slice(i, i + 20).join(',');
      const r2 = await fetch(
        `https://api.mercadolibre.com/items?ids=${chunk}&attributes=id,seller_sku,available_quantity`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const items = await r2.json();
      items.forEach(({ body }) => {
        if (body?.seller_sku) {
          estoqueMap[body.seller_sku] = (estoqueMap[body.seller_sku] || 0) + (body.available_quantity || 0);
        }
      });
    }
    res.json({ estoque: estoqueMap, total_itens: itemIds.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Brava Backend' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Brava backend rodando na porta ${PORT}`));
