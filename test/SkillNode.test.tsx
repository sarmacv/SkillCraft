import { render, screen } from '@testing-library/react';
import { SkillNode } from '../webview/src/SkillNode';

describe('SkillNode', () => {
  const mockData = {
    node: {
      type: 'source.rest',
      label: 'Test Node',
      config: { baseUrl: 'https://api.example.com' },
      targetOverrides: {},
      excludeTargets: [],
    },
    findings: [],
    target: 'all',
  };

  it('renders without crashing', () => {
    render(<SkillNode data={mockData} selected={false} />);
    expect(screen.getByText('Test Node')).toBeInTheDocument();
  });

  it('displays the correct subtitle for REST API', () => {
    render(<SkillNode data={mockData} selected={false} />);
    expect(screen.getByText('REST API')).toBeInTheDocument();
  });

  it('shows error badge when there are findings', () => {
    const dataWithFindings = {
      ...mockData,
      findings: [{ severity: 'error', message: 'Test error' }],
    };
    render(<SkillNode data={dataWithFindings} selected={false} />);
    expect(screen.getByLabelText('1 errors')).toBeInTheDocument();
  });

  it('shows warning badge when there are warnings', () => {
    const dataWithWarnings = {
      ...mockData,
      findings: [{ severity: 'warning', message: 'Test warning' }],
    };
    render(<SkillNode data={dataWithWarnings} selected={false} />);
    expect(screen.getByLabelText('1 warnings')).toBeInTheDocument();
  });

  it('displays the correct tooltip', () => {
    render(<SkillNode data={mockData} selected={false} />);
    expect(screen.getByTitle(/Choose a type/)).toBeInTheDocument();
  });
});
