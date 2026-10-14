/**
 * Groups prototype hook: if the player joined a group at /g/<code>, post the
 * finished daily total once and link back to the board. Silent on failure.
 */
export interface GroupMembership { code: string; name: string; player: string }
const KEY = "versemark:group";
const POSTED = "versemark:group-posted";

export function currentGroup(): GroupMembership | null {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? "null") as GroupMembership | null;
    return g && /^[A-Z0-9]{6}$/.test(g.code) && g.player ? g : null;
  } catch {
    return null;
  }
}

export async function postDailyToGroup(puzzle: number, total: number): Promise<GroupMembership | null> {
  const g = currentGroup();
  if (!g) return null;
  const mark = `${g.code}:${puzzle}`;
  if (localStorage.getItem(POSTED) === mark) return g;
  try {
    const r = await fetch(`/api/groups/${g.code}/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ puzzle, player: g.player, total }),
    });
    if (!r.ok) return null;
    localStorage.setItem(POSTED, mark);
    return g;
  } catch {
    return null;
  }
}
