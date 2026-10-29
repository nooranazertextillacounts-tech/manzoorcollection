import express from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import pg from 'pg';
import cors from 'cors';

export const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Lazy connection pool for Neon Postgres
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not defined");
    }
    pool = new pg.Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }
  return pool;
}

const ALLOWED_COLLECTIONS = [
  'branches', 'inventory', 'sales', 'customers', 'vendors',
  'purchases', 'expenses', 'payroll', 'employees', 'ledger',
  'users', 'settings', 'chart_of_accounts', 'stock_transfers', 'onlineSalesEmployees',
  'counters', 'activity_logs', 'salesmen', 'employeePurchases', 'employeeReturns',
  'ownerTransactions', 'expenseAccountHeads', 'attendance'
];

const verifiedTables = new Set<string>();

async function ensureTable(dbPool: pg.Pool, colName: string) {
  if (verifiedTables.has(colName)) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS "${colName}" (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
  `);
  verifiedTables.add(colName);
}

function generateFirestoreId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// 1. GET doc
app.post('/api/db/get', async (req, res) => {
  try {
    const { collection: colName, id } = req.body;
    if (!colName || !id) {
      return res.status(400).json({ error: "collection and id are required" });
    }
    if (!ALLOWED_COLLECTIONS.includes(colName)) {
      return res.status(400).json({ error: `Forbidden collection: ${colName}` });
    }

    const dbPool = getPool();
    await ensureTable(dbPool, colName);
    let result = await dbPool.query(`SELECT id, data FROM "${colName}" WHERE id = $1 OR data->>'id' = $1 LIMIT 1;`, [String(id)]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    res.json({ id: result.rows[0].id, data: { ...(result.rows[0].data || {}), id: result.rows[0].id } });
  } catch (error: any) {
    console.error("GET DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to get document" });
  }
});

// 2. QUERY docs
app.post('/api/db/query', async (req, res) => {
  try {
    const { collection: colName, filters, orderByField, orderByDirection, limitVal } = req.body;
    if (!colName) {
      return res.status(400).json({ error: "collection is required" });
    }
    if (!ALLOWED_COLLECTIONS.includes(colName)) {
      return res.status(400).json({ error: `Forbidden collection: ${colName}` });
    }

    const dbPool = getPool();
    await ensureTable(dbPool, colName);

    let queryStr = `SELECT id, data FROM "${colName}"`;
    const values: any[] = [];
    const whereClauses: string[] = [];

    if (Array.isArray(filters) && filters.length > 0) {
      filters.forEach((filter: any) => {
        const { field, op, val } = filter;
        if (typeof field !== 'string' || !/^[a-zA-Z0-9_]+$/.test(field)) {
          throw new Error(`Invalid query field: ${field}`);
        }
        
        const placeholder = `$${values.length + 1}`;
        
        if (op === '==' || op === '===') {
          if (val === null) {
            whereClauses.push(`((data->'${field}') IS NULL OR (data->>'${field}') = 'null')`);
          } else if (typeof val === 'boolean') {
            whereClauses.push(`(data->>'${field}')::boolean = ${placeholder}`);
            values.push(val);
          } else if (typeof val === 'number') {
            whereClauses.push(`(CASE WHEN (data->>'${field}') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (data->>'${field}')::numeric ELSE NULL END) = ${placeholder}`);
            values.push(val);
          } else {
            whereClauses.push(`data->>'${field}' = ${placeholder}`);
            values.push(String(val));
          }
        } else if (op === '!=' || op === '!==') {
          whereClauses.push(`data->>'${field}' != ${placeholder}`);
          values.push(String(val));
        } else if (op === '>' || op === '>=' || op === '<' || op === '<=') {
          if (typeof val === 'number') {
            whereClauses.push(`(CASE WHEN (data->>'${field}') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (data->>'${field}')::numeric ELSE NULL END) ${op} ${placeholder}`);
            values.push(val);
          } else {
            whereClauses.push(`data->>'${field}' ${op} ${placeholder}`);
            values.push(String(val));
          }
        } else if (op === 'in') {
          if (Array.isArray(val)) {
            whereClauses.push(`data->>'${field}' = ANY(${placeholder})`);
            values.push(val.map(String));
          } else {
            whereClauses.push(`data->>'${field}' = ${placeholder}`);
            values.push(String(val));
          }
        } else {
          whereClauses.push(`data->>'${field}' = ${placeholder}`);
          values.push(String(val));
        }
      });
    }

    if (whereClauses.length > 0) {
      queryStr += " WHERE " + whereClauses.join(" AND ");
    }

    if (orderByField) {
      if (typeof orderByField === 'string' && /^[a-zA-Z0-9_]+$/.test(orderByField)) {
        const dir = orderByDirection === 'desc' ? 'DESC' : 'ASC';
        queryStr += ` ORDER BY data->>'${orderByField}' ${dir}`;
      }
    }

    if (limitVal) {
      queryStr += ` LIMIT ${Number(limitVal)}`;
    }

    const result = await dbPool.query(queryStr, values);
    
    res.json(result.rows);
  } catch (error: any) {
    console.error("QUERY DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to query documents" });
  }
});

// 3. ADD doc (auto-ID)
app.post('/api/db/add', async (req, res) => {
  try {
    const { collection: colName, data } = req.body;
    if (!colName || !data) {
      return res.status(400).json({ error: "collection and data are required" });
    }
    if (!ALLOWED_COLLECTIONS.includes(colName)) {
      return res.status(400).json({ error: `Forbidden collection: ${colName}` });
    }

    const id = generateFirestoreId();
    const dbPool = getPool();
    await ensureTable(dbPool, colName);
    
    await dbPool.query(`
      INSERT INTO "${colName}" (id, data)
      VALUES ($1, $2::jsonb);
    `, [id, JSON.stringify(data)]);

    res.json({ id });
  } catch (error: any) {
    console.error("ADD DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to add document" });
  }
});

// 4. SET doc (overwrite or merge)
app.post('/api/db/set', async (req, res) => {
  try {
    const { collection: colName, id, data, merge } = req.body;
    if (!colName || !id || !data) {
      return res.status(400).json({ error: "collection, id, and data are required" });
    }
    if (!ALLOWED_COLLECTIONS.includes(colName)) {
      return res.status(400).json({ error: `Forbidden collection: ${colName}` });
    }

    const dbPool = getPool();
    await ensureTable(dbPool, colName);
    
    if (merge) {
      await dbPool.query(`
        INSERT INTO "${colName}" (id, data)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (id)
        DO UPDATE SET data = COALESCE("${colName}".data, '{}'::jsonb) || EXCLUDED.data;
      `, [id, JSON.stringify(data)]);
    } else {
      await dbPool.query(`
        INSERT INTO "${colName}" (id, data)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data;
      `, [id, JSON.stringify(data)]);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("SET DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to set document" });
  }
});

// 5. UPDATE doc (partial merge)
app.post('/api/db/update', async (req, res) => {
  try {
    const { collection: colName, id, data } = req.body;
    if (!colName || !id || !data) {
      return res.status(400).json({ error: "collection, id, and data are required" });
    }
    if (!ALLOWED_COLLECTIONS.includes(colName)) {
      return res.status(400).json({ error: `Forbidden collection: ${colName}` });
    }

    const dbPool = getPool();
    await ensureTable(dbPool, colName);
    
    await dbPool.query(`
      UPDATE "${colName}"
      SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb
      WHERE id = $1;
    `, [id, JSON.stringify(data)]);

    res.json({ success: true });
  } catch (error: any) {
    console.error("UPDATE DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to update document" });
  }
});

// 6. DELETE doc
app.post('/api/db/delete', async (req, res) => {
  try {
    const { collection: colName, id } = req.body;
    if (!colName || !id) {
      return res.status(400).json({ error: "collection and id are required" });
    }
    if (!ALLOWED_COLLECTIONS.includes(colName)) {
      return res.status(400).json({ error: `Forbidden collection: ${colName}` });
    }

    const dbPool = getPool();
    await ensureTable(dbPool, colName);
    await dbPool.query(`DELETE FROM "${colName}" WHERE id = $1;`, [id]);

    res.json({ success: true });
  } catch (error: any) {
    console.error("DELETE DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to delete document" });
  }
});

// 7. BATCH upsert
app.post('/api/db-batch/upsert', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: "records array is required" });
    }

    const dbPool = getPool();
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      for (const record of records) {
        const { collection: colName, id, data } = record;
        if (!ALLOWED_COLLECTIONS.includes(colName)) {
          throw new Error(`Forbidden collection name: ${colName}`);
        }
        await ensureTable(dbPool, colName);
        await client.query(`
          INSERT INTO "${colName}" (id, data)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (id)
          DO UPDATE SET data = EXCLUDED.data;
        `, [id, JSON.stringify(data)]);
      }
      await client.query('COMMIT');
      res.json({ success: true, count: records.length });
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("BATCH UPSERT DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to execute batch upsert" });
  }
});


app.post('/api/db-batch/migrate', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: "records array is required" });
    }

    const dbPool = getPool();
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      let skipped = 0;
      for (const record of records) {
        const { collection: colName, id, data } = record;
        if (!ALLOWED_COLLECTIONS.includes(colName)) {
          throw new Error(`Forbidden collection name: ${colName}`);
        }
        await ensureTable(dbPool, colName);
        const resDb = await client.query(`
          INSERT INTO "${colName}" (id, data)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (id) DO NOTHING
        `, [id, JSON.stringify(data)]);
        
        if (resDb.rowCount && resDb.rowCount > 0) inserted++;
        else skipped++;
      }
      await client.query('COMMIT');
      res.json({ success: true, count: records.length, inserted, skipped });
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("BATCH MIGRATE DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to execute batch migrate" });
  }
});

// 8. BATCH transaction & Invoice Sequence Management
app.get('/api/db/next-invoice', async (req, res) => {
  try {
    const branchId = req.query.branchId as string;
    const prefix = req.query.prefix as string;
    if (!branchId || !prefix) {
      return res.status(400).json({ error: "branchId and prefix are required" });
    }

    const dbPool = getPool();
    await ensureTable(dbPool, 'counters');
    await ensureTable(dbPool, 'sales');

    // Find the max sequence in actual sales matching this branch and prefix
    const salesResult = await dbPool.query(`
      SELECT data->>'invoiceNo' as invoice_no 
      FROM "sales" 
      WHERE data->>'branchId' = $1 AND data->>'invoiceNo' LIKE $2
    `, [branchId, `${prefix}%`]);

    let maxSaleSeq = 0;
    for (const row of salesResult.rows) {
      const inv = row.invoice_no;
      if (inv && inv.startsWith(prefix)) {
        const parts = inv.split('-');
        const seq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(seq) && seq > maxSaleSeq) {
          maxSaleSeq = seq;
        }
      }
    }

    // Check counter
    const id = `invoice_${branchId}`;
    const counterRes = await dbPool.query('SELECT data FROM "counters" WHERE id = $1', [id]);
    let currentCounterSeq = 0;
    if (counterRes.rows.length > 0) {
      const data = counterRes.rows[0].data;
      if (data && (data.prefix === prefix || !data.prefix)) {
        currentCounterSeq = Number(data.lastSeq) || 0;
      }
    }

    let effectiveBaseSeq = maxSaleSeq;
    if (currentCounterSeq > maxSaleSeq) {
      const checkSale = await dbPool.query(`
        SELECT id FROM "sales" 
        WHERE data->>'branchId' = $1 AND data->>'invoiceNo' = $2 
        LIMIT 1
      `, [branchId, `${prefix}${currentCounterSeq}`]);
      if (checkSale.rows.length > 0) {
        effectiveBaseSeq = currentCounterSeq;
      }
    }

    const nextSeq = effectiveBaseSeq + 1;
    res.json({ data: { nextSeq, invoiceNo: `${prefix}${nextSeq}` } });
  } catch (err: any) {
    console.error("NEXT INVOICE PREVIEW Error:", err);
    res.status(500).json({ error: err.message || "Failed to preview next invoice" });
  }
});

app.post('/api/db/allocate-invoice', async (req, res) => {
  try {
    const { branchId, prefix } = req.body;
    if (!branchId || !prefix) {
      return res.status(400).json({ error: "branchId and prefix are required" });
    }

    const dbPool = getPool();
    const client = await dbPool.connect();
    
    try {
      await client.query('BEGIN');
      await ensureTable(dbPool, 'counters');
      await ensureTable(dbPool, 'sales');
      
      const id = `invoice_${branchId}`;
      const result = await client.query(`
        SELECT data FROM "counters" WHERE id = $1 FOR UPDATE;
      `, [id]);
      
      let currentCounterSeq = 0;
      if (result.rows.length > 0) {
        const data = result.rows[0].data;
        if (data && (data.prefix === prefix || !data.prefix)) {
          currentCounterSeq = Number(data.lastSeq) || 0;
        }
      }

      // Also find the max sequence in actual sales for this branch and prefix
      const salesResult = await client.query(`
        SELECT data->>'invoiceNo' as invoice_no 
        FROM "sales" 
        WHERE data->>'branchId' = $1 AND data->>'invoiceNo' LIKE $2
      `, [branchId, `${prefix}%`]);
      
      let maxSaleSeq = 0;
      for (const row of salesResult.rows) {
        const inv = row.invoice_no;
        if (inv && inv.startsWith(prefix)) {
          const parts = inv.split('-');
          const seq = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(seq) && seq > maxSaleSeq) {
             maxSaleSeq = seq;
          }
        }
      }

      // Check if counter jumped ahead without a real sale (e.g. previous failed transaction)
      let effectiveBaseSeq = maxSaleSeq;
      if (currentCounterSeq > maxSaleSeq) {
        const checkSale = await client.query(`
          SELECT id FROM "sales" 
          WHERE data->>'branchId' = $1 AND data->>'invoiceNo' = $2 
          LIMIT 1
        `, [branchId, `${prefix}${currentCounterSeq}`]);
        if (checkSale.rows.length > 0) {
          effectiveBaseSeq = currentCounterSeq;
        }
      }

      const nextSeq = effectiveBaseSeq + 1;
      const invoiceNo = `${prefix}${nextSeq}`;
      const newData = { prefix, lastSeq: nextSeq };
      
      await client.query(`
        INSERT INTO "counters" (id, data)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data;
      `, [id, JSON.stringify(newData)]);
      
      await client.query('COMMIT');
      res.json({ data: { nextSeq, invoiceNo } });
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("ALLOCATE INVOICE Error:", error);
    res.status(500).json({ error: error.message || "Failed to allocate invoice" });
  }
});

app.post('/api/db-batch/transaction', async (req, res) => {
  try {
    const { writes } = req.body;
    if (!Array.isArray(writes)) {
      return res.status(400).json({ error: "writes array is required" });
    }

    const dbPool = getPool();
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      for (const op of writes) {
        const { type, collection: colName, id, data, merge } = op;
        if (!ALLOWED_COLLECTIONS.includes(colName)) {
          throw new Error(`Forbidden collection name: ${colName}`);
        }
        await ensureTable(dbPool, colName);
        
        if (type === 'set') {
          if (merge) {
            await client.query(`
              INSERT INTO "${colName}" (id, data)
              VALUES ($1, $2::jsonb)
              ON CONFLICT (id)
              DO UPDATE SET data = COALESCE("${colName}".data, '{}'::jsonb) || EXCLUDED.data;
            `, [id, JSON.stringify(data)]);
          } else {
            await client.query(`
              INSERT INTO "${colName}" (id, data)
              VALUES ($1, $2::jsonb)
              ON CONFLICT (id)
              DO UPDATE SET data = EXCLUDED.data;
            `, [id, JSON.stringify(data)]);
          }
        } else if (type === 'update') {
          await client.query(`
            UPDATE "${colName}"
            SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb
            WHERE id = $1;
          `, [id, JSON.stringify(data)]);
        } else if (type === 'delete') {
          await client.query(`
            DELETE FROM "${colName}" WHERE id = $1;
          `, [id]);
        }
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error("BATCH TRANSACTION DB Error:", error);
    res.status(500).json({ error: error.message || "Failed to execute batch transaction" });
  }
});

// Original Gemini chat assistant endpoint
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ 
        error: 'GEMINI_API_KEY environment variable is not set.' 
      });
    }

    const ai = new GoogleGenAI({ 
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        systemInstruction: 'You are an intelligent business assistant for a Boutique POS system. Answer questions clearly and concisely to help manage inventory, sales, and analytics.',
      }
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate content' });
  }
});
