/* eslint-disable i18next/no-literal-string */
/**
 * @jest-environment node
 */
import { renderToStaticMarkup as html } from 'react-dom/server';
import {
  Avatar,
  Chip,
  Notice,
  PageHeader,
  Panel,
  Pill,
  ProgressBar,
  SegmentedControl,
  StatTile,
  Stepper,
  Switch,
  Tabs,
} from '@/components/ui';

describe('UI kit', () => {
  it('Panel renders a titled card with actions and a selected state', () => {
    const out = html(
      <Panel title="Usage" actions={<button>Go</button>} selected>
        body
      </Panel>
    );

    expect(out).toContain('<h3');
    expect(out).toContain('Usage');
    expect(out).toContain('<button>Go</button>');
    expect(out).toContain('border-primary');
    expect(out.startsWith('<section')).toBe(true);
  });

  it('Panel can render another element and padding size', () => {
    expect(
      html(
        <Panel as="li" pad="lg">
          x
        </Panel>
      )
    ).toMatch(/^<li[^>]*p-6/);
    expect(html(<Panel pad="none">x</Panel>)).not.toMatch(/ p-[456]/);
  });

  it('PageHeader shows eyebrow, title, subtitle and actions', () => {
    const out = html(
      <PageHeader
        eyebrow="Ana · Job"
        title="Offer"
        subtitle="Draft"
        actions={<span>act</span>}
      />
    );

    expect(out).toContain('<h2');
    expect(out).toContain('Ana · Job');
    expect(out).toContain('Draft');
    expect(out).toContain('<span>act</span>');
    expect(html(<PageHeader as="h1" title="T" />)).toContain('<h1');
  });

  it('StatTile, Pill, Notice and Avatar render their content', () => {
    const out = html(
      <>
        <StatTile large label="Hires" value={3} hint="90d" tone="error" />
        <Pill tone="success">Paid</Pill>
        <Notice tone="warning">Fairness</Notice>
        <Avatar name="Ananya Krishnan" />
      </>
    );

    expect(out).toContain('Hires');
    expect(out).toContain('text-error');
    expect(out).toContain('text-success');
    expect(out).toContain('border-warning');
    expect(out).toContain('>AK<');
  });

  it('SegmentedControl and Tabs mark the active option', () => {
    const out = html(
      <>
        <SegmentedControl
          label="Range"
          value={30}
          onChange={() => undefined}
          options={[
            { value: 7, label: '7d' },
            { value: 30, label: '30d' },
          ]}
        />
        <Tabs
          value="a"
          onChange={() => undefined}
          tabs={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
      </>
    );

    expect(out).toMatch(/aria-pressed="true"[^>]*>30d/);
    expect(out).toMatch(/aria-pressed="false"[^>]*>7d/);
    expect(out).toMatch(/role="tab" aria-selected="true"[^>]*>A/);
  });

  it('Switch is a labelled checkbox; Chip is removable', () => {
    const out = html(
      <>
        <Switch label="Resume parsing" checked={false} onChange={() => 0} />
        <Chip removeLabel="Remove React" onRemove={() => undefined}>
          Skill: React
        </Chip>
      </>
    );

    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-label="Resume parsing"');
    expect(out).toContain('aria-label="Remove React"');
    expect(out).toContain('Skill: React');
  });

  it('ProgressBar warns from 80 % and Stepper marks done and current steps', () => {
    const bar = html(
      <ProgressBar
        label="Active jobs"
        value={12}
        max={15}
        valueLabel="12 / 15"
      />
    );
    const calm = html(<ProgressBar label="Seats" value={3} max={10} />);
    const steps = html(
      <Stepper
        label="Progress"
        current={1}
        steps={[
          { label: 'Account', done: true },
          { label: 'Resume' },
          { label: 'Apply' },
        ]}
      />
    );

    expect(bar).toContain('progress-warning');
    expect(calm).toContain('progress-primary');
    expect(steps).toMatch(/aria-current="step"[^>]*>Resume/);
    expect(steps).toContain('✓ Account');
  });
});
