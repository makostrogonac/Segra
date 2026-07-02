import DropdownSelect from '../DropdownSelect';
import {
  InputOverlayPosition,
  InputOverlayStyle,
  Settings as SettingsType,
} from '../../Models/types';
import { useAppState } from '../../Context/AppStateContext';

interface InputOverlaySectionProps {
  settings: SettingsType;
  updateSettings: (updates: Partial<SettingsType>) => void;
}

export default function InputOverlaySection({
  settings,
  updateSettings,
}: InputOverlaySectionProps) {
  const appState = useAppState();
  const isRecording = appState.recording != null || appState.preRecording != null;

  return (
    <div className="p-4 bg-base-300 rounded-lg shadow-md border border-custom">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-xl font-semibold">Input Overlay</h2>
        {isRecording && <span className="text-xs text-warning">(applies next recording)</span>}
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.inputOverlayEnabled}
          onChange={(e) => updateSettings({ inputOverlayEnabled: e.target.checked })}
          className="checkbox checkbox-primary checkbox-sm"
        />
        <span>Show keyboard, mouse, or controller inputs on recordings</span>
      </label>

      {settings.inputOverlayEnabled && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-base-content">Overlay</span>
            </label>
            <DropdownSelect
              items={[
                { value: 'KeyboardMouse', label: 'Keyboard + Mouse' },
                { value: 'XboxController', label: 'Xbox Controller' },
                { value: 'PlayStationController', label: 'PlayStation Controller' },
              ]}
              value={settings.inputOverlayStyle}
              onChange={(value) =>
                updateSettings({ inputOverlayStyle: value as InputOverlayStyle })
              }
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-base-content">Position</span>
            </label>
            <DropdownSelect
              items={[
                { value: 'TopLeft', label: 'Top left' },
                { value: 'TopRight', label: 'Top right' },
                { value: 'BottomLeft', label: 'Bottom left' },
                { value: 'BottomRight', label: 'Bottom right' },
              ]}
              value={settings.inputOverlayPosition}
              onChange={(value) =>
                updateSettings({ inputOverlayPosition: value as InputOverlayPosition })
              }
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-base-content">Size</span>
            </label>
            <DropdownSelect
              items={[
                { value: '0.75', label: 'Small' },
                { value: '1', label: 'Medium' },
                { value: '1.25', label: 'Large' },
              ]}
              value={String(settings.inputOverlayScale)}
              onChange={(value) => updateSettings({ inputOverlayScale: Number(value) })}
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text text-base-content">Opacity</span>
            </label>
            <DropdownSelect
              items={[
                { value: '0.5', label: '50%' },
                { value: '0.75', label: '75%' },
                { value: '1', label: '100%' },
              ]}
              value={String(settings.inputOverlayOpacity)}
              onChange={(value) => updateSettings({ inputOverlayOpacity: Number(value) })}
            />
          </div>
          {settings.inputOverlayStyle !== 'KeyboardMouse' && (
            <p className="col-span-2 text-xs text-base-content/70">
              Connect the controller before starting the recording.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
