import { createContext, useCallback, useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';

const ItemTypes = {
  INSTANCE: 'instance',
};

export const DragActivationContext = createContext<() => void>(() => {});

interface DragHandleProps {
  activateDrag: () => void;
  style?: React.CSSProperties;
}

export const DragHandle: React.FC<DragHandleProps> = ({ style, activateDrag }) => (
  <div
    className='drag-handle'
    style={style}
    onMouseDown={e => {
      e.stopPropagation();
      activateDrag();
    }}
  />
);

interface DraggableInstanceProps {
  index: number;
  instanceKey: string;
  moveInstance: (dragIndex: number, hoverIndex: number) => void;
  children: React.ReactNode;
}

export const DraggableInstance: React.FC<DraggableInstanceProps> = ({
  index,
  instanceKey,
  moveInstance,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragAllowedRef = useRef(false);

  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.INSTANCE,
    item: { index },
    canDrag: () => dragAllowedRef.current,
    collect: monitor => ({ isDragging: monitor.isDragging() }),
    end: () => {
      dragAllowedRef.current = false;
    },
  });

  drag(ref);

  const [, drop] = useDrop({
    accept: ItemTypes.INSTANCE,
    hover(item: { index: number }, monitor) {
      if (!ref.current) {
        return;
      }

      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) {
        return;
      }

      const hoverBoundingRect = ref.current.getBoundingClientRect();
      const boundingHeight = hoverBoundingRect.bottom - hoverBoundingRect.top;
      const hoverCutoffY = boundingHeight < 100 ? boundingHeight / 2 : 50;
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) {
        return;
      }
      const hoverClientY = clientOffset.y - hoverBoundingRect.top;

      if (
        (dragIndex < hoverIndex && hoverClientY < hoverCutoffY) ||
        (dragIndex > hoverIndex && hoverClientY > hoverCutoffY)
      ) {
        return;
      }
      moveInstance(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  drop(ref);

  const activateDrag = useCallback(() => {
    dragAllowedRef.current = true;
  }, []);

  return (
    <div ref={ref} key={instanceKey} style={{ opacity: isDragging ? 0.5 : 1 }}>
      <DragActivationContext.Provider value={activateDrag}>
        {children}
      </DragActivationContext.Provider>
    </div>
  );
};
