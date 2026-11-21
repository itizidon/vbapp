import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateDrillDialog } from "@/components/create-drill-dialog";
import { TrainingLibrary } from "@/components/training-videos";
import { gql } from "@/lib/api";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => ({ gql: vi.fn() }));
const options = {
  skillTree: {
    nodes: [{ id: "skill-id", name: "Platform control", status: "PUBLISHED" }],
  },
  sports: [
    {
      slug: "beach-volleyball",
      skills: [{ id: "category-id", name: "Passing", active: true }],
    },
  ],
};
const api = vi.mocked(gql);
function show(element = <CreateDrillDialog />) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {element}
    </QueryClientProvider>,
  );
}
async function fill() {
  fireEvent.click(screen.getByRole("button", { name: "Create drill" }));
  await screen.findByRole("combobox", { name: "Skill" });
  for (const [label, value] of [
    ["Drill name", "Passing rhythm"],
    ["Description", "Controlled passing to a partner."],
    ["Learning objective", "Maintain a repeatable platform."],
    ["Setup", "Stand on clear sand with a partner."],
    ["Step 1", "Pass toward your partner and reset."],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
beforeEach(() => {
  push.mockReset();
  api.mockReset();
  api.mockImplementation(async (query) =>
    query.includes("DrillCreationOptions")
      ? options
      : ({ createDrillWithContent: { id: "created-drill" } } as never),
  );
});
describe("coach drill creation", () => {
  it("publishes complete content and opens video management", async () => {
    show();
    await fill();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), {
      target: { value: "skill-id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and publish" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/admin/drills/created-drill/videos"),
    );
    const call = api.mock.calls.find(([query]) =>
      query.includes("mutation CreateDrillWithContent"),
    );
    expect(call?.[1]).toMatchObject({
      input: {
        drill: {
          slug: "passing-rhythm",
          status: "PUBLISHED",
          minPlayers: 1,
          maxPlayers: 2,
        },
        steps: [{ instruction: "Pass toward your partner and reset." }],
        primarySkillId: "skill-id",
      },
    });
  });
  it("can create the first skill without starter seed data", async () => {
    api.mockImplementation(async (query) =>
      query.includes("DrillCreationOptions")
        ? { ...options, skillTree: { nodes: [] } }
        : ({ createDrillWithContent: { id: "created-drill" } } as never),
    );
    show();
    await fill();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), {
      target: { value: "new" },
    });
    fireEvent.change(screen.getByLabelText("New skill name"), {
      target: { value: "Platform control" },
    });
    fireEvent.change(screen.getByLabelText("Volleyball category"), {
      target: { value: "category-id" },
    });
    fireEvent.change(screen.getByLabelText("Why this skill matters"), {
      target: { value: "Control the pass toward the setter." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and publish" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(
      api.mock.calls.find(([q]) =>
        q.includes("mutation CreateDrillWithContent"),
      )?.[1],
    ).toMatchObject({
      input: {
        newPrimarySkill: {
          name: "Platform control",
          categoryId: "category-id",
          status: "PUBLISHED",
        },
      },
    });
  });
  it("renders backend category IDs and labels, excluding inactive categories and other sports", async () => {
    const records = ["Attack", "Defense", "Passing", "Setting", "Serving"].map(
      (name, i) => ({
        id: `backend-category-${i}`,
        name: `${name} from backend`,
        active: true,
      }),
    );
    api.mockResolvedValue({
      ...options,
      sports: [
        {
          slug: "beach-volleyball",
          skills: [
            ...records,
            { id: "inactive", name: "Inactive category", active: false },
          ],
        },
        {
          slug: "other-sport",
          skills: [{ id: "other", name: "Other sport category", active: true }],
        },
      ],
    } as never);
    show();
    await fill();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), {
      target: { value: "new" },
    });
    const dropdown = screen.getByRole("combobox", {
      name: "Volleyball category",
    });
    expect(
      Array.from((dropdown as HTMLSelectElement).options)
        .slice(1)
        .map((o) => ({ id: o.value, name: o.textContent })),
    ).toEqual(records.map((r) => ({ id: r.id, name: r.name })));
    expect(
      screen.queryByRole("option", { name: "Inactive category" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Other sport category" }),
    ).not.toBeInTheDocument();
    expect(api.mock.calls[0][0]).toContain(
      "sports{slug skills{id name active}}",
    );
  });
  it("shows an empty state and reloads categories from the backend", async () => {
    let available = false;
    api.mockImplementation(
      async () =>
        ({
          ...options,
          sports: [
            {
              slug: "beach-volleyball",
              skills: available ? options.sports[0].skills : [],
            },
          ],
        }) as never,
    );
    show();
    await fill();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), {
      target: { value: "new" },
    });
    expect(
      screen.getByRole("combobox", { name: "Volleyball category" }),
    ).toBeDisabled();
    expect(
      screen.getByText("No active volleyball categories are available."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create and publish" }),
    ).toBeDisabled();
    available = true;
    fireEvent.click(screen.getByRole("button", { name: "Reload categories" }));
    await screen.findByRole("option", { name: "Passing" });
    expect(
      screen.getByRole("combobox", { name: "Volleyball category" }),
    ).toBeEnabled();
  });
  it("retains entries and allows retry after a server rejection", async () => {
    let rejected = true;
    api.mockImplementation(async (query) => {
      if (query.includes("DrillCreationOptions")) return options as never;
      if (rejected) throw new Error("That slug is already in use");
      return { createDrillWithContent: { id: "created-drill" } } as never;
    });
    show();
    await fill();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), {
      target: { value: "skill-id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That slug is already in use",
    );
    expect(screen.getByLabelText("Drill name")).toHaveValue("Passing rhythm");
    expect(push).not.toHaveBeenCalled();
    rejected = false;
    fireEvent.change(screen.getByLabelText(/URL slug/), {
      target: { value: "passing-rhythm-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and publish" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });
  it("rejects invalid player ranges before saving", async () => {
    show();
    await fill();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill" }), {
      target: { value: "skill-id" },
    });
    fireEvent.change(screen.getByLabelText("Minimum players"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Maximum players",
    );
    expect(
      api.mock.calls.filter(([q]) =>
        q.includes("mutation CreateDrillWithContent"),
      ),
    ).toHaveLength(0);
  });
  it("hides creation controls for ordinary players", async () => {
    api.mockImplementation(async (query) =>
      query.includes("TrainingEditorAccess")
        ? { canManageTraining: false }
        : ({ drills: [] } as never),
    );
    show(<TrainingLibrary admin />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Coach permissions",
    );
    expect(
      screen.queryByRole("button", { name: "Create drill" }),
    ).not.toBeInTheDocument();
  });
});
