# UI kit

Shared building blocks that match the design screens. Import from
`@/components/ui` (daisyUI wrappers `Button`, `Input`, `Badge`, `Alert`,
`Modal`, `Card` live in the same barrel).

| Component          | Use it for                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Panel`            | The rounded white card. `title`/`actions` add a heading row; `pad` is `none/sm/md/lg`; `as` renders `section`, `div`, `article`, `aside`, `li`, `fieldset` or `form`; `selected` gives the primary border (current plan, chosen job). |
| `PageHeader`       | Page title with `subtitle`, an `eyebrow` line above it and `actions` on the right.                                                                                                                                                    |
| `StatTile`         | A labelled number. `large` is the KPI tile; the default is the compact strip tile.                                                                                                                                                    |
| `Pill` / `Chip`    | Small status or score labels. `Chip` with `onRemove` is the removable filter chip.                                                                                                                                                    |
| `SegmentedControl` | Single choice: date range (`pills`), billing interval (`boxed`).                                                                                                                                                                      |
| `Tabs`             | Underline tabs for switching views on a page.                                                                                                                                                                                         |
| `Switch`           | On/off toggle. A checkbox with `role="switch"`; `label` is its accessible name.                                                                                                                                                       |
| `Notice`           | Boxed note: `info` (teal AI note), `muted`, `warning`, `error`.                                                                                                                                                                       |
| `Avatar`           | Initials in a circle (`sm`, `md`, `lg`).                                                                                                                                                                                              |
| `ProgressBar`      | Labelled progress that turns amber from 80 %.                                                                                                                                                                                         |
| `Stepper`          | Step pills: done (green ✓), current (filled, optional brand colour), later (outlined).                                                                                                                                                |
| `RadialScore`      | Circular percentage such as the AI match score.                                                                                                                                                                                       |
| `Field`            | A label above a control, with an optional hint.                                                                                                                                                                                       |

Tests: `__tests__/ui/kit.spec.tsx`.
