const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });

const now = () => new Date().toISOString();

const randomHex = (bytes = 24) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
};

const makeId = (prefix) => `${prefix}_${randomHex(10)}`;

const randomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map((x) => chars[x % chars.length]).join("");
};

const hash = async (text) => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(buf)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
};

async function auth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    ""
  );

  if (!token) return null;

  const tokenHash = await hash(token);

  return env.DB.prepare(`
    SELECT
      m.*,
      f.join_code,
      f.timezone
    FROM members m
    JOIN families f ON f.id = m.family_id
    WHERE m.token_hash = ?
  `)
    .bind(tokenHash)
    .first();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/" || path === "/api/health") {
        return json({
          ok: true,
          service: "BUDGET PACK API",
          time: now(),
        });
      }

      if (path === "/api/family/create" && request.method === "POST") {
        const body = await request.json();

        const familyId = makeId("fam");
        const memberId = makeId("mem");
        const token = randomHex(24);
        const joinCode = randomCode();
        const time = now();

        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO families
            (id,name,join_code,timezone,data_json,version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?)
          `).bind(
            familyId,
            body.familyName || "Budget familial",
            joinCode,
            body.timezone || "America/Toronto",
            "{}",
            0,
            time,
            time
          ),

          env.DB.prepare(`
            INSERT INTO members
            (id,family_id,name,role,token_hash,created_at)
            VALUES (?,?,?,?,?,?)
          `).bind(
            memberId,
            familyId,
            body.memberName || "Moi",
            "owner",
            await hash(token),
            time
          ),
        ]);

        return json({
          familyId,
          memberId,
          token,
          joinCode,
          version: 0,
        });
      }

      if (path === "/api/family/join" && request.method === "POST") {
        const body = await request.json();

        const family = await env.DB.prepare(`
          SELECT * FROM families WHERE join_code = ?
        `)
          .bind(String(body.joinCode || "").trim().toUpperCase())
          .first();

        if (!family) {
          return json({ error: "Code famille introuvable" }, 404);
        }

        const memberId = makeId("mem");
        const token = randomHex(24);

        await env.DB.prepare(`
          INSERT INTO members
          (id,family_id,name,role,token_hash,created_at)
          VALUES (?,?,?,?,?,?)
        `)
          .bind(
            memberId,
            family.id,
            body.memberName || "Membre",
            "member",
            await hash(token),
            now()
          )
          .run();

        return json({
          familyId: family.id,
          memberId,
          token,
          joinCode: family.join_code,
        });
      }

      const member = await auth(request, env);

      if (!member) {
        return json({ error: "Non autorisé" }, 401);
      }

      if (path === "/api/state" && request.method === "GET") {
        const family = await env.DB.prepare(`
          SELECT data_json, version, updated_at
          FROM families
          WHERE id = ?
        `)
          .bind(member.family_id)
          .first();

        return json({
          data: JSON.parse(family.data_json || "{}"),
          version: family.version,
          updatedAt: family.updated_at,
          joinCode: member.join_code,
        });
      }

      if (path === "/api/state" && request.method === "PUT") {
        const body = await request.json();

        const family = await env.DB.prepare(`
          SELECT data_json, version
          FROM families
          WHERE id = ?
        `)
          .bind(member.family_id)
          .first();

        if (Number(body.version) !== Number(family.version)) {
          return json(
            {
              error: "Conflit de synchronisation",
              data: JSON.parse(family.data_json || "{}"),
              version: family.version,
            },
            409
          );
        }

        const nextVersion = Number(family.version) + 1;
        const time = now();

        await env.DB.prepare(`
          UPDATE families
          SET data_json = ?, version = ?, updated_at = ?
          WHERE id = ?
        `)
          .bind(
            JSON.stringify(body.data || {}),
            nextVersion,
            time,
            member.family_id
          )
          .run();

        return json({
          ok: true,
          version: nextVersion,
          updatedAt: time,
        });
      }

      if (path === "/api/me" && request.method === "GET") {
        return json({
          memberId: member.id,
          memberName: member.name,
          familyId: member.family_id,
          joinCode: member.join_code,
        });
      }

      return json({ error: "Route introuvable" }, 404);
    } catch (error) {
      return json(
        {
          error: error?.message || "Erreur serveur",
        },
        500
      );
    }
  },
};
