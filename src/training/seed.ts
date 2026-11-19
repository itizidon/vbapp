import { PrismaService } from "../prisma/prisma.service";
import { TrainingAccess } from "./access";
import { TrainingLibraryService } from "./library.service";
import { TrainingRecommendations } from "./recommendations.service";
// Explicit development seed; service validation/authorization is reused. Existing records are never overwritten.
export async function seedTraining(db: PrismaService, editor: string) {
  const access = new TrainingAccess(db);
  await access.editor(editor);
  const lib = new TrainingLibraryService(db, access),
    rules = new TrainingRecommendations(db, access, lib);
  const categories = await db.skill.findMany({
    where: {
      sport: { slug: "beach-volleyball" },
      active: true,
      slug: { in: ["attack", "defense", "passing", "setting", "serving"] },
    },
  });
  if (categories.length !== 5)
    throw new Error(
      "Initialize the existing five beach volleyball categories first",
    );
  const nodes: Record<string, string> = {};
  const createdNodes = new Set<string>();
  for (const [slug, name, category, objective] of [
    [
      "approach-footwork",
      "Approach Footwork",
      "attack",
      "Coordinate a repeatable approach and balanced final plant.",
    ],
    [
      "contact-timing",
      "Contact Timing",
      "attack",
      "Coordinate approach timing with set trajectory rather than chasing the ball.",
    ],
    [
      "off-net-attacking",
      "Off-Net Attacking",
      "attack",
      "Create usable space and select a controlled legal attack away from a tight set.",
    ],
    [
      "controlled-shot-placement",
      "Controlled Shot Placement",
      "attack",
      "Direct controlled attacks toward open court with legal beach volleyball contact.",
    ],
    [
      "tight-set-recovery",
      "Tight-Set Recovery",
      "attack",
      "Recognize a tight set early, communicate, and choose a safe legal recovery.",
    ],
    [
      "ready-position",
      "Ready Position",
      "passing",
      "Stay balanced and ready to move before the serve crosses the net.",
    ],
    [
      "platform-control",
      "Platform Control",
      "passing",
      "Build a stable platform and control its angle to the target.",
    ],
    [
      "passing-to-target",
      "Passing to Target",
      "passing",
      "Use footwork and platform angle to pass consistently to a useful target.",
    ],
  ] as const) {
    let n = await db.skillTreeNode.findUnique({ where: { slug } });
    if (!n) {
      createdNodes.add(slug);
      n = await lib.createNode(editor, {
        slug,
        name,
        categoryId: categories.find((c) => c.slug === category)!.id,
        description: objective,
        learningObjective: objective,
        whyItMatters:
          "A repeatable foundation creates more useful options under match pressure.",
        tier: "FOUNDATION",
        difficulty: 2,
        status: "PUBLISHED",
        tags: ["development-example"],
      });
    }
    nodes[slug] = n.id;
  }
  for (const [skill, pre] of [
    ["contact-timing", "approach-footwork"],
    ["off-net-attacking", "contact-timing"],
    ["controlled-shot-placement", "off-net-attacking"],
    ["tight-set-recovery", "controlled-shot-placement"],
    ["platform-control", "ready-position"],
    ["passing-to-target", "platform-control"],
  ]) {
    if (
      createdNodes.has(skill) &&
      !(await db.skillPrerequisite.findUnique({
        where: {
          skillId_prerequisiteId: {
            skillId: nodes[skill],
            prerequisiteId: nodes[pre],
          },
        },
      }))
    )
      await lib.setPrerequisites(editor, nodes[skill], [
        { prerequisiteId: nodes[pre], required: false },
      ]);
  }
  for (const [slug, name, skill, steps] of [
    [
      "three-step-approach",
      "Three-Step Approach Practice",
      "approach-footwork",
      [
        "Mark a safe takeoff area away from the net.",
        "Rehearse a comfortable approach without a ball, using a balanced final plant.",
        "Add a gentle toss only when footwork remains consistent; stop if landing space is unsafe.",
      ],
    ],
    [
      "off-net-shot-placement",
      "Off-Net Shot Placement",
      "off-net-attacking",
      [
        "Place a target in open court and position the toss well off the net.",
        "Use a controlled approach and choose an appropriate legal beach volleyball contact.",
        "Alternate targets while maintaining a balanced landing and discuss the most useful set location.",
      ],
    ],
    [
      "tight-set-recovery-practice",
      "Tight-Set Recovery Practice",
      "tight-set-recovery",
      [
        "Agree on a safe spacing and a verbal tight-set cue.",
        "Use gentle varied tosses; recognize tight trajectories early without entering the net.",
        "Call the constraint and choose a safe legal recovery option; do not force an unsafe swing.",
      ],
    ],
    [
      "partner-platform-passing",
      "Partner Platform Passing",
      "platform-control",
      [
        "Stand a comfortable distance apart with a clear training area.",
        "Toss easy balls; move behind the ball and hold a stable platform angle.",
        "Pass toward the partner target, reset balance, and alternate roles.",
      ],
    ],
    [
      "target-passing",
      "Target Passing",
      "passing-to-target",
      [
        "Mark a target area that gives the setter room to move.",
        "Use gentle serves or tosses and pass toward the target.",
        "Record useful passes out of ten attempts; adjust footwork and angle, not only arm swing.",
      ],
    ],
  ] as const) {
    if (await db.drill.findUnique({ where: { slug } })) continue;
    const drill = await lib.createDrill(editor, {
      slug,
      name,
      description: "Development example: " + name,
      objective:
        "Practice a repeatable, controlled movement and assess its consistency.",
      setup:
        "Use a clear sand area, a ball, a safe landing zone, and a visible target.",
      durationMinutes: 10,
      minPlayers: slug === "three-step-approach" ? 1 : 2,
      maxPlayers: 4,
      equipment: ["ball", "target"],
      coachingCues: [
        "Reset balance between repetitions",
        "Favor safe, controlled execution over maximum effort",
      ],
      safetyNotes: "Keep landing space clear and stop if discomfort occurs.",
      difficulty: "BEGINNER",
      bestForSummary:
        "Players who report difficulty with the targeted technique; individual capability remains unknown until reported.",
    });
    await lib.setSteps(
      editor,
      drill.id,
      steps.map((instruction) => ({ instruction })),
    );
    await lib.setSkills(editor, drill.id, [
      { skillTreeNodeId: nodes[skill], role: "PRIMARY" },
      ...(slug === "off-net-shot-placement"
        ? [
            {
              skillTreeNodeId: nodes["controlled-shot-placement"],
              role: "SECONDARY" as const,
            },
          ]
        : []),
    ]);
    await lib.updateDrill(editor, drill.id, { status: "PUBLISHED" });
    await lib.variant(editor, {
      drillId: drill.id,
      slug: "standard-right",
      name: "Standard right-handed demonstration",
      description: "A right-handed example; not a universal movement template.",
      isDefault: true,
      status: "PUBLISHED",
    });
    await lib.variant(editor, {
      drillId: drill.id,
      slug: "left-handed",
      name: "Left-handed demonstration",
      description: "An accepted left-handed execution variant.",
      status: "PUBLISHED",
    });
    await rules.saveRule(editor, {
      drillId: drill.id,
      name: "Reported difficulty matches this drill",
      rationale:
        "Use the player’s own description of a training need, not height as a proxy for ability.",
      conditions: {
        version: 1,
        root: { fact: "reportedDifficulty", op: "contains", value: skill },
      },
      effect: "BOOST",
      priority: 5,
    });
    if (slug === "off-net-shot-placement")
      await rules.saveRule(editor, {
        drillId: drill.id,
        name: "Tight-set or clearance difficulty",
        rationale:
          "Create off-net options when a player reports a tight-set or clearance problem. This does not assume reach from height.",
        conditions: {
          version: 1,
          root: {
            any: [
              {
                fact: "reportedDifficulty",
                op: "contains",
                value: "tight_set_attacking",
              },
              {
                fact: "reportedDifficulty",
                op: "contains",
                value: "limited_attack_clearance",
              },
            ],
          },
        },
        effect: "BOOST",
        priority: 8,
      });
  }
  for (const slug of [
    "tight_set_attacking",
    "limited_attack_clearance",
    "inconsistent_serve_receive",
    "poor_platform_angle",
    "late_approach_timing",
    "difficulty_reading_defenders",
    "inconsistent_set_location",
    "low_serving_consistency",
  ])
    await db.coachingSituation.upsert({
      where: { slug },
      create: {
        slug,
        name: slug.replaceAll("_", " "),
        description:
          "A reported playing situation that can inform structured drill targeting.",
        status: "PUBLISHED",
      },
      update: {},
    });
  return { nodes: Object.keys(nodes).length };
}
