# LaunchNestAI — Marketing Automation Pipeline (v1)

*Reference overview of the 5-agent system that markets LaunchNestAI itself to prospective Etsy sellers. Written as a map of how the pieces fit together — each agent's full system prompt lives in its own file in this folder.*

---

## Goal

Make LaunchNestAI's marketing nearly hands-off, while Kim stays in control of what actually gets published. Nothing posts without her explicit approval.

## The weekly loop

```
Strategy Agent → Creative Agent → Review Agent → KIM APPROVES → Publishing Agent → Analytics Agent → (back to Strategy)
```

1. **[Strategy Agent](strategy-agent.md)** — decides what to say and to whom. Produces a weekly brief of exactly 3 post ideas, rotating across 3 target personas, pulling only from an approved facts list so it can't invent product claims.
2. **[Creative Agent](creative-agent.md)** — turns each post idea into platform-specific caption copy and generates the actual image (brand palette: warm ivory, teal, warm gold).
3. **[Review Agent](review-agent.md)** — the last automated checkpoint. Checks every post against facts, brand voice, visuals, format, and CTA rules before anything reaches Kim. Auto-fixes mechanical issues only; anything touching a claim, price, or brand judgment gets flagged for Kim instead of silently changed.
4. **Kim approves** — the one step that is never automated. Nothing is scheduled without her sign-off.
5. **[Publishing Agent](publishing-agent.md)** — schedules approved posts into Buffer, which posts to Pinterest and Instagram.
6. **[Analytics Agent](analytics-agent.md)** — pulls last week's Buffer performance data, summarizes what worked by persona/angle/platform, and feeds that back into next week's Strategy brief.

## Target personas (v1)

Narrowed down from 5 candidates to 3 for the first version, so results stay easy to read:

1. **Overwhelmed new shop owner** — wants to look professional/credible fast.
2. **Time-strapped established seller** — wants to spend less time on marketing.
3. **Social-media-avoidant seller** — wants marketing done for them.

Deferred for later: *sale/promo-driven seller* (more of a seasonal trigger than a standing persona) and *concierge seeker* (the Made-to-Order path isn't a fully self-serve feature yet — marketing it heavily now risks setting expectations the product can't fully deliver on).

## Key v1 scope decisions

- **Platforms:** Pinterest + Instagram only. No Facebook/TikTok/video yet.
- **Format:** Text + static image only. No video in v1.
- **Before/after visuals (angle H):** deferred — requires real screenshots of published landing pages, which aren't yet available as a content source. Revisit once real examples exist.
- **Images:** generated as illustrative, brand-styled concepts via the connected AI image tool — never fabricated as real app screenshots.
- **Scheduler:** Buffer, chosen specifically because its 2026 MCP server lets an AI agent schedule posts directly, rather than requiring manual re-entry into a dashboard every week.

## Setup still needed before this can run for real

- [ ] Create a free Buffer account, connect Pinterest and Instagram to it.
- [ ] Connect Buffer's MCP server to the automation session so the Publishing Agent can actually schedule posts.
- [ ] Decide how/when this pipeline actually runs each week (manual trigger vs. a scheduled cron agent).

## Guardrails that apply across every agent

- Never claim: automatic social media posting, guaranteed sales/traffic, that LaunchNestAI replaces an Etsy shop, an editable Canva template, that the PDF guide is the landing page itself, a concierge/custom service, or a subscription.
- Every factual claim must trace back to the approved facts list in `strategy-agent.md` §3.
- Any claim, price, or brand-judgment issue gets flagged to Kim — never silently auto-fixed.
