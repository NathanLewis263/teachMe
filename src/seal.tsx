// muted teal-grey, lit from the top left
const L = "#b7cccb",
  L1 = "#a9c0bf",
  L2 = "#9db5b4";
const M = "#8fa9a8",
  M1 = "#86a1a0",
  M2 = "#7d9998";
const D = "#6f8c8b",
  D1 = "#678483",
  D2 = "#5e7b7a";

// key vertices
const T = "32,84",
  b1 = "50,68",
  b2 = "72,58",
  b3 = "94,54",
  N = "108,48"; // back line, tail to neck
const m1 = "54,82",
  m2 = "78,78",
  m3 = "100,74",
  m4 = "116,66"; // mid-body
const g0 = "34,96",
  g1 = "56,98",
  g2 = "80,99",
  g3 = "100,98",
  C = "116,92"; // belly on the ground
const CF = "124,78",
  TH = "126,64"; // chest front, throat
const H0 = "110,34",
  H1 = "122,24",
  H2 = "136,26",
  HC = "130,42"; // head
const S1 = "146,38",
  S2 = "151,46",
  S3 = "144,54",
  SN = "143,46",
  J = "132,58"; // snout and jaw

type F = [string, string];
const BACK: F[] = [
  [`${T} ${b1} ${m1}`, L1],
  [`${b1} ${b2} ${m1}`, L2],
  [`${b2} ${m2} ${m1}`, L1],
  [`${b2} ${b3} ${m2}`, L],
  [`${b3} ${m3} ${m2}`, L1],
  [`${b3} ${N} ${m3}`, L2],
  [`${N} ${m4} ${m3}`, L1],
  [`${N} ${H0} ${m4}`, L2],
  [`${H0} ${HC} ${m4}`, M],
  [`${m4} ${HC} ${TH}`, M1],
  [`${m4} ${TH} ${CF}`, D],
  [`${m4} ${CF} ${C}`, D1],
];
const BELLY: F[] = [
  [`${T} ${m1} ${g0}`, M1],
  [`${m1} ${g1} ${g0}`, D1],
  [`${m1} ${m2} ${g1}`, M2],
  [`${m2} ${g2} ${g1}`, D2],
  [`${m2} ${m3} ${g2}`, M1],
  [`${m3} ${g3} ${g2}`, D1],
  [`${m3} ${m4} ${g3}`, M2],
  [`${m4} ${C} ${g3}`, D2],
];
const HEAD: F[] = [
  [`${H0} ${H1} ${HC}`, L],
  [`${H1} ${H2} ${HC}`, L1],
  [`${H2} ${S1} ${HC}`, L2],
  [`${S1} ${SN} ${HC}`, M],
  [`${S1} ${S2} ${SN}`, L1],
  [`${S2} ${S3} ${SN}`, M1],
  [`${SN} ${S3} ${J}`, D],
  [`${HC} ${SN} ${J}`, M2],
  [`${HC} ${J} ${TH}`, D1],
];
const facet = ([points, fill]: F, i: number) => (
  <polygon
    key={i}
    points={points}
    fill={fill}
    stroke={fill}
    strokeWidth="0.6"
    strokeLinejoin="round"
  />
);

export default function Seal({ state }: { state: string }) {
  return (
    <div className={`seal seal-${state.toLowerCase()}`} aria-hidden="true">
      <svg viewBox="0 0 160 112" aria-hidden="true">
        <ellipse cx="86" cy="103" rx="66" ry="5" fill="rgba(0,0,0,0.22)" />
        <g className="seal-wobble">
          <g className="seal-squish">
            {/* far front flipper, mostly behind the body */}
            <polygon
              className="flip-far"
              points="114,80 124,82 140,104 120,104"
              fill={D2}
              stroke={D2}
              strokeWidth="0.6"
            />
            {/* rear flippers fanned at the tail */}
            <polygon
              points="32,84 12,72 4,78 10,86 30,92"
              fill={D}
              stroke={D}
              strokeWidth="0.6"
            />
            <polygon
              points="34,92 10,98 6,104 16,106 40,98"
              fill={D1}
              stroke={D1}
              strokeWidth="0.6"
            />
            {BACK.map(facet)}
            <g className="seal-belly">{BELLY.map(facet)}</g>
            <g className="seal-head">
              {HEAD.map(facet)}
              {/* beady eyes */}
              <polygon
                points="130,33 134,31 137,34 137,38 133,40 130,37"
                fill="#1b2326"
              />
              <polygon points="131.5,33.5 133.5,32.6 133.6,34.6" fill="#fff" />
              <polygon
                points="142,31 144.5,30 146,32 145,35 142.5,35.5"
                fill="#1b2326"
              />
              {/* nose and mouth */}
              <polygon points="147,41 152,44 148,47" fill="#1b2326" />
              <polyline
                points="148,47 146,51 142,52"
                fill="none"
                stroke="#1b2326"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <polygon
                points="126,44 132,45 128,48"
                fill="#e8a3b5"
                opacity="0.6"
              />
              {/* whiskers */}
              <g stroke="#1b2326" strokeWidth="1.1" strokeLinecap="round">
                <line x1="144" y1="47" x2="158" y2="43" />
                <line x1="144" y1="49.5" x2="159" y2="49" />
                <line x1="143" y1="52" x2="156" y2="56" />
              </g>
            </g>
            {/* near front flipper, splayed forward on the ground */}
            <polygon
              className="flip-near"
              points="104,78 116,82 134,104 112,105 106,96"
              fill={M2}
              stroke={M2}
              strokeWidth="0.6"
              strokeLinejoin="round"
            />
            <polygon
              className="flip-near"
              points="116,82 134,104 126,104"
              fill={D}
              stroke={D}
              strokeWidth="0.6"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
