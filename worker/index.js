export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    const gh = async () => {
      const r = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/contents/database/users.json`,
        { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}` } }
      );
      const d = await r.json();
      return JSON.parse(atob(d.content));
    };

    if (url.pathname === "/api/login" && req.method === "POST") {
      const b = await req.json();
      const users = await gh();
      const ok = users.find(u=>u.username===b.username&&u.password===b.password);
      return new Response(ok?"OK":"FAIL",{status:ok?200:401});
    }

    if (url.pathname === "/api/users") {
      return new Response(JSON.stringify(await gh()),{
        headers:{'Content-Type':'application/json'}
      });
    }

    return new Response("Not Found",{status:404});
  }
}
