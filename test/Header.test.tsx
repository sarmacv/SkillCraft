import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../webview/src/Header';

describe('Header Component', () => {
  const mockOnTarget = jest.fn();
  const mockOnLayout = jest.fn();
  const state = {
    project: { name: 'Test Project', targets: ['claude'], buildMode: 'tailored' },
    readiness: 'draft',
    readinessChecklist: [{ done: false }],
    portability: { claude: 'ok' },
    language: 'python',
  };

  it('renders the header with project name', () => {
    render(<Header state={state} target="all" onTarget={mockOnTarget} onLayout={mockOnLayout} />);
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('displays readiness stages correctly', () => {
    render(<Header state={state} target="all" onTarget={mockOnTarget} onLayout={mockOnLayout} />);
    expect(screen.getByLabelText('Readiness')).toHaveAttribute('title', 'Next: Draft');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('calls onTarget when a target button is clicked', () => {
    render(<Header state={state} target="claude" onTarget={mockOnTarget} onLayout={mockOnLayout} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Claude' }));
    expect(mockOnTarget).toHaveBeenCalledWith('claude');
  });

  it('calls onLayout when layout button is clicked', () => {
    render(<Header state={state} target="all" onTarget={mockOnTarget} onLayout={mockOnLayout} />);
    fireEvent.click(screen.getByLabelText('Tidy the layout'));
    expect(mockOnLayout).toHaveBeenCalled();
  });

  it('renders the language select when project exists', () => {
    render(<Header state={state} target="all" onTarget={mockOnTarget} onLayout={mockOnLayout} />);
    expect(screen.getByLabelText('Script language')).toBeInTheDocument();
  });
});
