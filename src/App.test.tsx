import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from './App';
import { INITIAL_PORTALS } from './data/initial-portals';
import { advancePortals } from './lib/portal-rules';
import { STORAGE_KEY } from './lib/storage';

describe('панель управления', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('показывает стартовый список порталов и приоритетную очередь', () => {
    render(<App />);
    expect(screen.getAllByRole('button').some((button) => button.textContent?.includes('A1'))).toBe(true);
    expect(screen.getByText('Очередь внимания')).toBeInTheDocument();
    expect(screen.getByText(/За минуту: выберите портал/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Восстановить демо-данные' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /^(Низкий|Средний|Высокий|Критический) риск · (\d+:\d{2}|\d+ сек|Закрыт) · внутри: \d+$/,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/\$\{riskLabels/)).not.toBeInTheDocument();
    const portalList = within(
      screen.getByRole('complementary', { name: 'Список порталов по убыванию риска' }),
    );
    const displayedRisks = portalList.getAllByRole('button').map((button) =>
      Number(button.textContent?.match(/Риск (\d+)/)?.[1]),
    );
    expect(displayedRisks).toEqual([...displayedRisks].sort((left, right) => right - left));
  });

  it('позволяет создать портал из пустого списка', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [] }),
    );
    render(<App />);

    expect(screen.getByText('Нет активных порталов')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить портал' })[0]);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новый проход' } });
    fireEvent.change(screen.getByLabelText('Мир назначения'), { target: { value: 'Северная станция' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать запись' }));

    expect(screen.getAllByText('Новый проход').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('create_portal'),
    );
  });

  it('запрещает создавать портал с уже занятым названием', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [INITIAL_PORTALS[0]] }),
    );
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Добавить портал' })[0]);
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: `  ${INITIAL_PORTALS[0].name.toLocaleLowerCase('ru-RU')} ` },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('уже существует');
    expect(screen.getByRole('button', { name: 'Создать запись' })).toBeDisabled();
  });

  it('не скрывает портал «под вопросом» за первыми тремя элементами очереди', () => {
    const timestamp = new Date().toISOString();
    const highRiskPortals = ['high-1', 'high-2', 'high-3'].map((id, index) => ({
      ...INITIAL_PORTALS[1],
      id,
      name: `Высокий риск ${index + 1}`,
      energyLevel: 20,
      energyUpdatedAt: timestamp,
      baseEnergyDrainPerMinute: 1,
      stability: 40,
      timeToCollapseMinutes: 30,
      collapseEstimateUpdatedAt: timestamp,
      collapseDeadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      occupants: 0,
      underQuestion: false,
    }));
    const questioned = {
      ...INITIAL_PORTALS[1],
      id: 'questioned',
      name: 'Проверить этот портал',
      energyLevel: 80,
      energyUpdatedAt: timestamp,
      baseEnergyDrainPerMinute: 1,
      stability: 90,
      timeToCollapseMinutes: 180,
      collapseEstimateUpdatedAt: timestamp,
      collapseDeadlineAt: new Date(Date.now() + 180 * 60_000).toISOString(),
      occupants: 0,
      underQuestion: true,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [...highRiskPortals, questioned] }),
    );
    render(<App />);

    const attentionItems = screen.getAllByRole('button').filter((button) =>
      button.textContent?.includes('Приоритет '),
    );
    expect(attentionItems).toHaveLength(4);
    expect(attentionItems[3]).toHaveTextContent('Проверить этот портал');
  });

  it('восстанавливает демо-данные только после явного подтверждения', async () => {
    const customPortal = {
      ...INITIAL_PORTALS[1],
      id: 'user-created-portal',
      name: 'Пользовательский портал',
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [customPortal] }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить демо-данные' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('будут заменены');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('user-created-portal');

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить демо-данные' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить сброс' }));
    expect(screen.getByText(/Демонстрационные данные восстановлены/)).toBeInTheDocument();
    expect(screen.getByText(/Стартовые демо-порталы циклично/)).toBeInTheDocument();
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain('user-created-portal'),
    );
    expect(screen.getAllByRole('button').some((button) =>
      button.textContent?.includes('A1 — Красные ворота'),
    )).toBe(true);
  });

  it('показывает встроенный Worklog с оценкой времени и статистикой токенов', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Worklog' }));

    expect(screen.getByRole('heading', { name: 'AI Worklog' })).toBeInTheDocument();
    expect(screen.getByText('Около 6 часов.')).toBeInTheDocument();
    expect(screen.getByText(/Количество токенов не измерялось/)).toBeInTheDocument();
  });

  it('отклоняет критическую отправку наблюдателя и добавляет отказ в журнал', async () => {
    const critical = INITIAL_PORTALS.find((portal) => portal.id === 'portal-a1')!;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [critical] }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить наблюдателя' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Действие отклонено');
    expect(screen.getByRole('alert')).toHaveTextContent('критическим риском');
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"result":"blocked"'),
    );
  });

  it('показывает заметное предупреждение при отказе в стабилизации', async () => {
    const lowEnergy = {
      ...INITIAL_PORTALS[1],
      energyLevel: 1,
      energyUpdatedAt: new Date().toISOString(),
      baseEnergyDrainPerMinute: 100 / 180,
      stability: 70,
      timeToCollapseMinutes: 1 / ((100 / 180) * 1.3),
      collapseEstimateUpdatedAt: new Date().toISOString(),
      collapseDeadlineAt: new Date(Date.now() + 1 / ((100 / 180) * 1.3) * 60_000).toISOString(),
      occupants: 0,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [lowEnergy] }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Стабилизировать' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Действие отклонено');
    expect(screen.getByRole('alert')).toHaveTextContent('Недостаточно энергии');
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"result":"blocked"'),
    );
  });

  it('сохраняет происшествие в архиве и журнале без отдельного показателя потерь в карточке', async () => {
    const portal = {
      ...INITIAL_PORTALS[1],
      energyLevel: 0,
      energyUpdatedAt: new Date().toISOString(),
      baseEnergyDrainPerMinute: 1,
      timeToCollapseMinutes: 0,
      occupants: 2,
    };
    const collapsed = advancePortals([portal], Date.now())[0];
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [collapsed] }),
    );

    const { unmount } = render(<App />);
    expect(screen.getByText('Потеряны 2; требуется внимание')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Критические происшествия' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Стеклянный путь/ }));
    expect(screen.getByRole('heading', { name: 'Архив закрытых порталов' })).toBeInTheDocument();
    expect(screen.getByText('Остались по другую сторону')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Энергия исчерпана')).toBeInTheDocument();
    expect(screen.queryByText('Потеряны', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('число потерь сохранены в журнале');
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"incidentReviewedAt"'),
    );

    unmount();
    render(<App />);
    expect(screen.queryByText('Потеряны 2; требуется внимание')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Критические происшествия' })).not.toBeInTheDocument();
    expect(screen.getByText('Требуют внимания').parentElement).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Журнал событий' }));
    expect(screen.getByText('Происшествие при схлопывании · B3 — Стеклянный путь')).toBeInTheDocument();
    expect(screen.getByText('Критическое происшествие · требует внимания')).toBeInTheDocument();
    expect(screen.getByText(/потеряны 2/)).toBeInTheDocument();
    expect(screen.getAllByText((_, element) =>
      element?.tagName === 'TIME' && Boolean(element.textContent),
    ).length).toBeGreaterThan(0);
  });

  it('позволяет указать количество людей/существ при фиксации выхода', async () => {
    const occupied = {
      ...INITIAL_PORTALS[0],
      occupants: 10,
      timeToCollapseMinutes: 30,
      collapseEstimateUpdatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [occupied] }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать выход' }));
    fireEvent.change(screen.getByLabelText('Сколько вышло?'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать' }));

    expect(screen.getByRole('status')).toHaveTextContent('выход 5');
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"occupants":5'),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('record_occupant_exit');
  });

  it('запускает визит наблюдателя и учитывает его внутри на время визита', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [INITIAL_PORTALS[1]] }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить наблюдателя' }));
    expect(screen.getByRole('status')).toHaveTextContent('вошёл в портал на 5 минут');
    expect(screen.getByText(/До завершения: \d+:\d{2}/)).toBeInTheDocument();
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"kind":"observer"'),
    );
    const savedPortals = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').portals;
    const observer = savedPortals[0].pendingOperation;
    expect(Date.parse(observer.completesAt) - Date.parse(observer.startedAt)).toBe(5 * 60_000);
  });

  it('возвращает действие «под вопросом» и даёт снять отметку', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Пометить под вопросом' }));

    expect(screen.getByText('Под вопросом')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Снять отметку «под вопросом»' }));
    expect(screen.queryByText('Под вопросом')).not.toBeInTheDocument();
  });

  it('показывает оформленное подтверждение закрытия и позволяет отказаться', () => {
    const occupied = { ...INITIAL_PORTALS[0], timeToCollapseMinutes: 20 };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [occupied] }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть портал' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Внутри остаются');
    fireEvent.click(screen.getByRole('button', { name: 'Не закрывать' }));
    expect(screen.getByRole('status')).toHaveTextContent('Закрытие отменено');
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain('"kind":"close"');
  });

  it('подтверждённое закрытие запускает отменяемую операцию', async () => {
    const occupied = {
      ...INITIAL_PORTALS[1],
      timeToCollapseMinutes: 60,
      occupants: 1,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [occupied] }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть портал' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить закрытие' }));

    expect(screen.getByRole('status')).toHaveTextContent('операция началась');
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"kind":"close"'),
    );
  });

  it('не заменяет повреждённые данные и разрешает продолжить явно без сохранения', () => {
    window.localStorage.setItem(STORAGE_KEY, '{broken');
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('Исходные данные не изменены');
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить без сохранения' }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });

  it('сохраняет изменение в памяти после сбоя записи и предлагает повторить запись', async () => {
    render(<App />);
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    fireEvent.click(screen.getAllByRole('button').find((button) => button.textContent?.includes('B3'))!);
    fireEvent.click(screen.getByRole('button', { name: 'Стабилизировать' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('quota exceeded'),
    );
    writeSpy.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранение' }));

    expect(screen.getByRole('status')).toHaveTextContent('Изменения сохранены');
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"kind":"stabilize"');
  });
});
