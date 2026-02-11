import PersonalTask from '../models/PersonalTask.js';

export const getTasks = async (req, res) => {
    try {
        const userId = req.user.id; // Assumes middleware populates req.user
        const { date, status } = req.query;

        let query = { user: userId };

        if (date) {
            // Match specific date (ignoring time for daily dashboard)
            const start = new Date(date);
            start.setHours(0, 0, 0, 0);
            const end = new Date(date);
            end.setHours(23, 59, 59, 999);
            query.datetime = { $gte: start, $lte: end };
        }

        if (status) {
            query.status = status;
        }

        const tasks = await PersonalTask.find(query).sort({ datetime: 1 });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const createTask = async (req, res) => {
    try {
        const userId = req.user.id;
        const task = new PersonalTask({ ...req.body, user: userId });
        await task.save();
        res.status(201).json(task);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export const updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await PersonalTask.findOneAndUpdate(
            { _id: id, user: req.user.id },
            req.body,
            { new: true }
        );
        if (!task) return res.status(404).json({ message: "Task not found" });
        res.json(task);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export const deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await PersonalTask.findOneAndDelete({ _id: id, user: req.user.id });
        if (!task) return res.status(404).json({ message: "Task not found" });
        res.json({ message: "Task deleted" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
