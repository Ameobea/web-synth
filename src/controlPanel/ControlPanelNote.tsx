import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { useDispatch } from 'react-redux';
import showdown from 'showdown';
import showdownXssFilter from 'showdown-xss-filter';

import { type ModalCompProps, renderModalWithControls } from 'src/controls/Modal';
import BasicModal from 'src/misc/BasicModal';
import { useDraggable } from 'src/reactUtils';
import { actionCreators } from 'src/redux';
import type { ControlPanelVisualizationDescriptor } from 'src/redux/modules/controlPanel';
import { UnimplementedError } from 'src/util';

const MarkdownRenderer = new showdown.Converter({ extensions: [showdownXssFilter] });
MarkdownRenderer.setFlavor('github');

const mkConfigureViz = (
  providedControl: ControlPanelVisualizationDescriptor,
  _providedName: string
): React.FC<{
  onSubmit: (val: { control: ControlPanelVisualizationDescriptor; name: string }) => void;
  onCancel?: () => void;
}> => {
  const ConfigureControlPanelViz: React.FC<
    ModalCompProps<{ control: ControlPanelVisualizationDescriptor; name: string }>
  > = ({ onSubmit, onCancel }) => {
    const [control, setControl] = useState(providedControl);

    const settings = useMemo(() => {
      switch (control.type) {
        case 'note':
          return [
            { type: 'text', label: 'title' },
            { type: 'checkbox', label: 'markdown' },
            { type: 'range', label: 'width', min: 50, max: 1000, step: 5 },
            { type: 'range', label: 'height', min: 50, max: 1000, step: 5 },
            { type: 'text', label: 'font size' },
          ];
        default:
          throw new UnimplementedError();
      }
    }, [control.type]);

    return (
      <BasicModal>
        <div className='control-panel-input-configurator'>
          <ControlPanel
            width={400}
            settings={settings}
            state={useMemo(() => {
              switch (control.type) {
                case 'note':
                  return {
                    title: control.title,
                    markdown: control.markdown,
                    width: control.style.width,
                    height: control.style.height,
                    'font size': control.style.fontSize,
                  };
                default:
                  throw new UnimplementedError(`Viz type not yet implemented: ${control.type}`);
              }
            }, [control])}
            onChange={(key: string, val: any) => {
              switch (control.type) {
                case 'note': {
                  switch (key) {
                    case 'width':
                    case 'height':
                      setControl({ ...control, style: { ...control.style, [key]: +val } });
                      break;
                    case 'title':
                      setControl({ ...control, title: val });
                      break;
                    case 'markdown':
                      setControl({ ...control, markdown: !!val });
                      break;
                    case 'font size':
                      setControl({
                        ...control,
                        style: {
                          ...control.style,
                          fontSize: Number.isNaN(+val) || val !== `${+val}` ? val : +val,
                        },
                      });
                      break;
                    default:
                      console.error('Unhandled viz setting type: ', key);
                  }
                  break;
                }
                default:
                  throw new UnimplementedError(`Viz type not yet implemented: ${control.type}`);
              }
            }}
          />

          <div className='buttons'>
            <button onClick={() => onSubmit({ control, name: control.name })}>Save</button>
            <button onClick={onCancel}>Close</button>
          </div>
        </div>
      </BasicModal>
    );
  };
  return ConfigureControlPanelViz;
};

const renderMarkdown = (
  content: string
): { type: 'html'; content: string } | { type: 'react'; content: React.ReactNode } => {
  try {
    const rendered = MarkdownRenderer.makeHtml(content);
    return { type: 'html', content: rendered };
  } catch (err) {
    return {
      type: 'react',
      content: <span style={{ color: 'red' }}>Error rendering markdown: {`${err}`}</span>,
    };
  }
};

interface DragBarProps {
  vcId: string;
  control: Extract<ControlPanelVisualizationDescriptor, { type: 'note' }>;
  isEditing: boolean;
}

const DragBar: React.FC<DragBarProps> = ({ vcId, control, isEditing }) => {
  const dispatch = useDispatch();
  const onDrag = useCallback(
    (newPos: { x: number; y: number }) =>
      dispatch(actionCreators.controlPanel.SET_CONTROL_PANEL_VIZ_POS(vcId, control.name, newPos)),
    [dispatch, control.name, vcId]
  );
  const { isDragging, onMouseDown } = useDraggable(onDrag, control.position);

  return (
    <div
      onMouseDown={isEditing ? onMouseDown : undefined}
      style={isEditing ? { cursor: isDragging ? 'grabbing' : 'grab' } : undefined}
      className='control-panel-note-drag-bar'
    >
      <div
        className='configure-input-button'
        onClick={async () => {
          try {
            const { control: newControl, name: newName } = await renderModalWithControls(
              mkConfigureViz(control, control.name)
            );
            console.log(newControl);
            dispatch(
              actionCreators.controlPanel.UPDATE_CONTROL_PANEL_VIZ(vcId, newName, newControl)
            );
          } catch (_err) {
            // pass
          }
        }}
      >
        ⚙️
      </div>
      <div
        className='delete-input-button'
        onClick={() => {
          const shouldDelete = confirm(`Really delete this module named "${control.name}"?`);
          if (!shouldDelete) {
            return;
          }
          dispatch(actionCreators.controlPanel.DELETE_CONTROL_PANEL_VIZ(vcId, control.name));
        }}
      >
        🗑️
      </div>
      {control.title}
    </div>
  );
};

interface ControlPanelNoteProps
  extends Extract<ControlPanelVisualizationDescriptor, { type: 'note' }> {
  vcId: string;
  isEditing: boolean;
}

const ControlPanelNote: React.FC<ControlPanelNoteProps> = ({
  vcId,
  isEditing: isEditingControlPanel,
  ...control
}) => {
  const { content, style, position } = control;
  const [isEditing, setIsEditing] = useState(false);
  const [editingContent, setEditingContent] = useState(content);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const cb = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsEditing(false);
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          return;
        }

        setIsEditing(false);
        dispatch(
          actionCreators.controlPanel.UPDATE_CONTROL_PANEL_VIZ(vcId, control.name, {
            ...control,
            content: editingContent,
          })
        );
      }
    };

    document.addEventListener('keydown', cb);

    return () => {
      document.removeEventListener('keydown', cb);
    };
  }, [control, dispatch, editingContent, isEditing, vcId]);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // Focus the textarea as soon as it's mounted
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.focus();
      // Set cursor position to end
      textAreaRef.current.selectionStart = textAreaRef.current.value.length;
    }
  }, [isEditing]);
  const renderedContent = useMemo(() => {
    if (isEditing) {
      return null;
    }

    const rendered = control.markdown
      ? renderMarkdown(control.content)
      : { type: 'react' as const, content: control.content };

    const style = isEditingControlPanel ? { cursor: 'pointer' } : undefined;
    return rendered.type === 'react' ? (
      <div
        onDoubleClick={isEditingControlPanel ? () => setIsEditing(true) : undefined}
        className='control-panel-note-content'
        style={style}
      >
        {rendered.content}
      </div>
    ) : (
      <div
        onDoubleClick={isEditingControlPanel ? () => setIsEditing(true) : undefined}
        className='control-panel-note-content'
        style={style}
      >
        <div
          style={{ paddingBottom: 6, whiteSpace: 'normal', overflow: 'hidden' }}
          dangerouslySetInnerHTML={{ __html: rendered.content }}
        />
      </div>
    );
  }, [control.content, control.markdown, isEditing, isEditingControlPanel]);

  return (
    <div className='control-panel-note' style={{ ...style, top: position.y, left: position.x }}>
      <DragBar vcId={vcId} control={control} isEditing={isEditingControlPanel} />
      {isEditing ? (
        <textarea
          ref={textAreaRef}
          value={editingContent}
          onChange={e => setEditingContent(e.target.value)}
          style={{ fontSize: style.fontSize }}
        />
      ) : (
        renderedContent
      )}
    </div>
  );
};

export default ControlPanelNote;
