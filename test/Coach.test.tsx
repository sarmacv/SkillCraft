import { render, screen, fireEvent } from '@testing-library/react';
import { Coach } from '../webview/src/Coach';

describe('Coach Component', () => {
  const mockState = {
    coachBusy: false,
    coach: [],
  };

  test('renders the coach component', () => {
    render(<Coach state={mockState} />);
    expect(screen.getByText(/The coach reviews your skill/i)).toBeInTheDocument();
  });

  test('displays loading state when coach is busy', () => {
    const busyState = { ...mockState, coachBusy: true };
    render(<Coach state={busyState} />);
    expect(screen.getByText(/Reviewing…/i)).toBeInTheDocument();
  });

  test('displays empty note when no questions are available', () => {
    render(<Coach state={mockState} />);
    expect(screen.getByText(/No open questions/i)).toBeInTheDocument();
  });

  test('renders questions when available', () => {
    const questionState = {
      ...mockState,
      coach: [{ id: '1', area: 'Test Area', question: 'Test Question' }],
    };
    render(<Coach state={questionState} />);
    expect(screen.getByText(/Test Question/i)).toBeInTheDocument();
  });
});
