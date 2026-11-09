import type { DelegatedTeam } from "./agent-activity.ts";

const chiefId = "brain";
type Point = { x: number; y: number };
type Role = "chief" | "director" | "specialist" | "developer";

export function delegationLayout(
  teams: DelegatedTeam[], horizontal: boolean, children: Map<string, string[]> = new Map(),
) {
  const card = { width: horizontal ? 206 : 164, height: 84 };
  const along = horizontal ? card.width : card.height;
  const across = horizontal ? card.height : card.width;
  const stageGap = horizontal ? 84 : 66;
  const leafPitch = across + 22;
  const widestTeam = Math.max(
    1,
    ...teams.map((team) => team.specialists.reduce(
      (count, id) => count + Math.max(1, children.get(id)?.length ?? 0), 0,
    )),
  );
  const teamPitch = widestTeam * leafPitch + 12;
  const margin = 28;
  const breadth =
    across +
    (Math.max(teams.length, 1) - 1) * teamPitch +
    (widestTeam - 1) * leafPitch +
    2 * margin;
  const depth = children.size ? 4 : teams.length ? 3 : 1;
  const length = depth * along + (depth - 1) * stageGap + 2 * margin;
  const size = horizontal
    ? { width: length, height: breadth }
    : { width: breadth, height: length };
  const midpoint = breadth / 2;
  const position = (depth: number, offset: number): Point => {
    const advance = margin + along / 2 + depth * (along + stageGap);
    return horizontal
      ? { x: advance, y: midpoint + offset }
      : { x: midpoint + offset, y: advance };
  };
  const place = (id: string, role: Role, depth: number, offset: number) => ({
    id,
    role,
    center: position(depth, offset),
  });

  const chief = place(chiefId, "chief", 0, 0);
  const branches = teams.map((team, index) => {
    const offset = (index - (teams.length - 1) / 2) * teamPitch;
    const width = team.specialists.reduce(
      (count, id) => count + Math.max(1, children.get(id)?.length ?? 0), 0,
    );
    let cursor = offset - (width - 1) * leafPitch / 2;
    return {
      director: place(team.lead, "director", 1, offset),
      specialists: team.specialists.map((id) => {
        const reports = children.get(id) ?? [];
        const span = Math.max(1, reports.length);
        const specialist = place(id, "specialist", 2, cursor + (span - 1) * leafPitch / 2);
        const developers = reports.map((agent, i) => place(agent, "developer", 3, cursor + i * leafPitch));
        cursor += span * leafPitch;
        return { specialist, developers };
      }),
    };
  });
  const nodes = [
    chief,
    ...branches.flatMap(({ director, specialists }) => [
      director,
      ...specialists.flatMap(({ specialist, developers }) => [specialist, ...developers]),
    ]),
  ];

  function connect(parent: typeof chief, children: typeof nodes) {
    if (!children.length) return null;
    const edge = (point: Point, direction: number) =>
      horizontal
        ? { x: point.x + (direction * along) / 2, y: point.y }
        : { x: point.x, y: point.y + (direction * along) / 2 };
    const start = edge(parent.center, 1);
    const ends = children.map((child) => edge(child.center, -1));
    const joint = (end: Point) =>
      horizontal
        ? { x: start.x + stageGap / 2, y: end.y }
        : { x: end.x, y: start.y + stageGap / 2 };
    const first = joint(ends[0]);
    const last = joint(ends[ends.length - 1]);
    const hub = joint(start);
    const xy = ({ x, y }: Point) => `${x} ${y}`;
    return {
      parent: parent.id,
      trunk: `M ${xy(start)} L ${xy(hub)} M ${xy(first)} L ${xy(last)}`,
      arms: ends.map((end, index) => ({
        id: children[index].id,
        path: `M ${xy(joint(end))} L ${xy(end)}`,
        end,
      })),
      hub,
    };
  }

  return {
    size,
    card,
    nodes,
    routes: [
      connect(
        chief,
        branches.map(({ director }) => director),
      ),
      ...branches.flatMap(({ director, specialists }) => [
        connect(director, specialists.map(({ specialist }) => specialist)),
        ...specialists.map(({ specialist, developers }) => connect(specialist, developers)),
      ],
      ),
    ].filter((route) => route !== null),
  };
}
