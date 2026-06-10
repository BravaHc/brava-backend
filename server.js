const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = '4848281438121790';
const CLIENT_SECRET = 'X1jZh2eHy6kCuiLX9y4uW7RL0zRN5qTE';

const ITEM_SKU_MAP = {
  'MLB6908037554':'A08045','MLB6922218456':'A08040','MLB4741545277':'A08041',
  'MLB6861832850':'46.645','MLB6203256952':'MXT546-580','MLB6867513082':'MXT546-580',
  'MLB6449611540':'860511','MLB4506628917':'44.146','MLB4671169385':'44.146',
  'MLB6447789142':'44.146','MLB6754680904':'44.145','MLB4504000721':'44.145',
  'MLB4526960751':'44.145','MLB6428887592':'44.145','MLB6723411546':'44.145',
  'MLB6298193916':'MCN766P','MLB6407925496':'MCN765P','MLB4505548255':'MCN764P',
  'MLB6455765606':'7.756','MLB6307369998':'1.693','MLB6747369456':'45.099',
  'MLB6248387572':'28.788','MLB6755548456':'28.788','MLB4387435733':'1X 26.638',
  'MLB4387036565':'2X 37.358','MLB6099490620':'1X 19.802','MLB6469912208':'BG-066 PRO PRETO',
  'MLB6115703772':'RCAI-072','MLB4472030953':'RCAI-072','MLB6074347100':'44.977',
  'MLB6115761644':'RCAI-2038','MLB4695336387':'RCAI-2037','MLB4378365713':'RCAI-2037',
  'MLB4440283661':'RCAI-2037','MLB6194445692':'RCAI-2037','MLB6201018700':'RCAI-2037',
  'MLB4609950961':'Mesa 180cm','MLB4620939401':'Mesa 180cm','MLB5480335774':'RCAI-072',
};

app.post('/auth/token', async (req, res) => {
  const { code, refresh_token, grant_type } = req.body;
  try {
    const body = new URLSearchParams({
      grant_type: grant_type || 'authorization_code',
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      ...(code ? { code, redirect_uri: 'https://httpbin.org/get' } : {}),
      ...(refresh_token ? { refresh_token } : {})
    });
    const r = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    const r = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${token}` } });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/vendas/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { userId } = req.params;
  const dias = req.query.dias || 30;
  const dataFrom = new Date();
  dataFrom.setDate(dataFrom.getDate() - dias);
  const dataFromStr = dataFrom.toISOString().split('.')[0] + '.000-03:00';
  try {
    let todas = [], offset = 0, total = 1;
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
        const sku = item.item?.seller_sku || ITEM_SKU_MAP[item.item?.id] || item.item?.id || 'SEM_SKU';
        vendasPorSku[sku] = (vendasPorSku[sku] || 0) + (item.quantity || 0);
      });
    });
    res.json({ total_pedidos: todas.length, dias, vendas_por_sku: vendasPorSku });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/estoque-full/:userId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { userId } = req.params;
  try {
    let itemIds = [], offset = 0, total = 1;
    while (offset < total && itemIds.length < 200) {
      const r = await fetch(
        `https://api.mercadolibre.com/users/${userId}/items/search?limit=100&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json();
      total = data.paging?.total || 0;
      itemIds = itemIds.concat(data.results || []);
      offset += 100;
    }
    if (!itemIds.length) return res.json({ estoque: {}, total_itens: 0 });

    const estoqueMap = {};

    for (let i = 0; i < itemIds.length; i += 20) {
      const chunk = itemIds.slice(i, i + 20).join(',');
      const r2 = await fetch(
        `https://api.mercadolibre.com/items?ids=${chunk}&attributes=id,seller_sku,inventory_id,available_quantity`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const items = await r2.json();

      for (const { body } of items) {
        if (!body || body.error) continue;
        const sku = body.seller_sku || ITEM_SKU_MAP[body.id];
        if (!sku) continue;

        if (body.inventory_id) {
          try {
            const rInv = await fetch(
              `https://api.mercadolibre.com/inventories/${body.inventory_id}/stock/fulfillment`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const inv = await rInv.json();
            estoqueMap[sku] = (estoqueMap[sku] || 0) + (inv.available_quantity || 0);
          } catch(e) {
            estoqueMap[sku] = (estoqueMap[sku] || 0) + (body.available_quantity || 0);
          }
        } else {
          estoqueMap[sku] = (estoqueMap[sku] || 0) + (body.available_quantity || 0);
        }
      }
    }

    res.json({ estoque: estoqueMap, total_itens: itemIds.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Brava Backend v7' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Brava backend v7 rodando na porta ${PORT}`));
