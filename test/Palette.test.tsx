import { render, screen, fireEvent } from '@testing-library/react';
import { Palette, DRAG_MIME } from '../src/Palette';

const mockOnAdd = jest.fn();

describe('Palette Component', () => {
  beforeEach(() => {
    render(<Palette onAdd={mockOnAdd} target="all" />);
  });

  test('renders search input', () => {
    const searchInput = screen.getByPlaceholderText('Search components');
    expect(searchInput).toBeInTheDocument();
  });

  test('updates query state on input change', () => {
    const searchInput = screen.getByPlaceholderText('Search components');
    fireEvent.change(searchInput, { target: { value: 'test' } });
    expect(searchInput.value).toBe('test');
  });

  test('calls onAdd when an item is double-clicked', () => {
    const item = screen.getByText(/Some source…/); // Assuming this item is rendered
    fireEvent.doubleClick(item);
    expect(mockOnAdd).toHaveBeenCalledWith('placeholder.source');
  });

  test('starts drag event with correct data', () => {
    const item = screen.getByText(/Some source…/); // Assuming this item is rendered
    const dragStartEvent = new DragEvent('dragstart');
    Object.defineProperty(dragStartEvent, 'dataTransfer', {
      value: {
        setData: jest.fn(),
        effectAllowed: '',
      },
    });
    fireEvent.dragStart(item, dragStartEvent);
    expect(dragStartEvent.dataTransfer.setData).toHaveBeenCalledWith(DRAG_MIME, 'placeholder.source');
  });
});
