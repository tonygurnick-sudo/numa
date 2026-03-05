# Test Datasets for DB CLI Tool

This document lists diverse public CSV datasets with direct download URLs for testing the `db` CLI tool.

## Quick Reference

| Category          | Dataset              | Size    | Records | URL                                                                                                         |
| ----------------- | -------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| **Air Travel**    | Monthly passengers   | 14 KB   | 144     | https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv                                                 |
| **COVID-19**      | Countries aggregated | 5.3 MB  | 161,569 | https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv                      |
| **Weather**       | Seattle 1948-2016    | ~200 KB | ~25,000 | https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv                      |
| **Finance**       | Apple stock          | ~500 KB | ~3,000  | https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv                           |
| **Sales**         | Monthly car sales    | 3 KB    | 108     | https://raw.githubusercontent.com/jbrownlee/Datasets/master/monthly-car-sales.csv                           |
| **Titanic**       | Passengers           | 60 KB   | 891     | https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv                               |
| **Education**     | College grads        | 75 KB   | 173     | https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv               |
| **Iris**          | Flower measurements  | 5 KB    | 150     | https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv                                      |
| **Google Sheets** | Student class data   | ~2 KB   | ~30     | https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0 |

---

## 1. Air Travel Data (Small - 14 KB)

**URL**: https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv

**Size**: 14 KB, 144 rows

**Columns**: Month, 1958, 1959, 1960 (passenger counts by year)

**Good for testing**:

- Basic aggregations
- Trend analysis over time
- Year-over-year comparisons
- Small dataset performance

**Example queries**:

```bash
# Simple count
./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" "SELECT COUNT(*) FROM data"

# Natural language
./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" --ask "what month had the most passengers in 1960?"

# Agentic investigation
./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" --ask "analyze air travel growth patterns" --auto
```

---

## 2. COVID-19 Global Data (Large - 5.3 MB)

**URL**: https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv

**Size**: 5.3 MB, 161,569 rows

**Columns**: Date, Country, Confirmed, Recovered, Deaths

**Good for testing**:

- Large dataset performance
- Time series analysis
- Multi-country comparisons
- DuckDB vs SQLite performance
- Aggregations and GROUP BY

**Example queries**:

```bash
# Top countries by cases
./db --csv "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv" \
  "SELECT Country, MAX(Confirmed) as total_cases FROM data GROUP BY Country ORDER BY total_cases DESC LIMIT 10"

# Natural language
./db --csv "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv" \
  --ask "which countries had the most COVID deaths?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/datasets/covid-19/main/data/countries-aggregated.csv" \
  --ask "analyze COVID case trends and find anomalies" --auto
```

---

## 3. Seattle Weather Data (Medium - 200 KB)

**URL**: https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv

**Size**: ~200 KB, ~25,000 rows

**Columns**: Date, Max_TemperatureC, Mean_TemperatureC, Min_TemperatureC, Dew_PointC, MeanDew_PointC, Min_DewpointC, Max_Humidity, Mean_Humidity, Min_Humidity, Max_Sea_Level_PressurehPa, Mean_Sea_Level_PressurehPa, Min_Sea_Level_PressurehPa, Max_VisibilityKm, Mean_VisibilityKm, Min_VisibilitykM, Max_Wind_SpeedKm_h, Mean_Wind_SpeedKm_h, Max_Gust_SpeedKm_h, Precipitationmm, CloudCover, Events, WindDirDegrees

**Good for testing**:

- Historical weather analysis
- Seasonal patterns
- Temperature extremes
- Multi-column analysis
- Date range queries

**Example queries**:

```bash
# Hottest days
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv" \
  "SELECT Date, Max_TemperatureC FROM data ORDER BY Max_TemperatureC DESC LIMIT 10"

# Natural language
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv" \
  --ask "what was the average temperature by month in 2016?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/2016-weather-data-seattle.csv" \
  --ask "analyze Seattle weather patterns and find extreme weather events" --auto
```

---

## 4. Apple Stock Market Data (Medium - 500 KB)

**URL**: https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv

**Size**: ~500 KB, ~3,000 rows

**Columns**: Date, AAPL.Open, AAPL.High, AAPL.Low, AAPL.Close, AAPL.Volume, AAPL.Adjusted, dn, mavg, up, direction

**Good for testing**:

- Financial data analysis
- Price trends
- Volume analysis
- Moving averages
- Technical indicators

**Example queries**:

```bash
# Highest closing price
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv" \
  "SELECT Date, \"AAPL.Close\" FROM data ORDER BY \"AAPL.Close\" DESC LIMIT 10"

# Natural language
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv" \
  --ask "what were the top 10 trading days by volume?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/plotly/datasets/master/finance-charts-apple.csv" \
  --ask "analyze Apple stock price trends and volatility patterns" --auto
```

---

## 5. Monthly Car Sales (Tiny - 3 KB)

**URL**: https://raw.githubusercontent.com/jbrownlee/Datasets/master/monthly-car-sales.csv

**Size**: 3 KB, 108 rows

**Columns**: Month, Sales

**Good for testing**:

- Time series forecasting
- Seasonal patterns
- Simple trend analysis
- Fast queries

**Example queries**:

```bash
# Average sales per month
./db --csv "https://raw.githubusercontent.com/jbrownlee/Datasets/master/monthly-car-sales.csv" \
  "SELECT AVG(Sales) as avg_sales FROM data"

# Natural language
./db --csv "https://raw.githubusercontent.com/jbrownlee/Datasets/master/monthly-car-sales.csv" \
  --ask "which months had the highest car sales?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/jbrownlee/Datasets/master/monthly-car-sales.csv" \
  --ask "analyze car sales trends and identify seasonal patterns" --auto
```

---

## 6. Titanic Passengers (Small - 60 KB)

**URL**: https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv

**Size**: 60 KB, 891 rows

**Columns**: PassengerId, Survived, Pclass, Name, Sex, Age, SibSp, Parch, Ticket, Fare, Cabin, Embarked

**Good for testing**:

- Survival analysis
- Demographic patterns
- Class-based analysis
- Missing data handling
- Multiple categorical variables

**Example queries**:

```bash
# Survival rate by class
./db --csv "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" \
  "SELECT Pclass, AVG(Survived) as survival_rate FROM data GROUP BY Pclass ORDER BY Pclass"

# Natural language
./db --csv "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" \
  --ask "what was the survival rate for men vs women?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" \
  --ask "analyze what factors influenced survival on the Titanic" --auto
```

---

## 7. College Graduates by Major (Small - 75 KB)

**URL**: https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv

**Size**: 75 KB, 173 rows

**Columns**: Rank, Major_code, Major, Major_category, Total, Sample_size, Men, Women, ShareWomen, Employed, Full_time, Part_time, Full_time_year_round, Unemployed, Unemployment_rate, Median, P25th, P75th, College_jobs, Non_college_jobs, Low_wage_jobs

**Good for testing**:

- Education data analysis
- Salary comparisons
- Employment rates
- Gender representation
- Career outcomes

**Example queries**:

```bash
# Highest median salaries
./db --csv "https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv" \
  "SELECT Major, Median FROM data ORDER BY Median DESC LIMIT 10"

# Natural language
./db --csv "https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv" \
  --ask "which majors have the highest unemployment rates?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv" \
  --ask "analyze the relationship between major category, salary, and employment outcomes" --auto
```

---

## 8. Iris Flower Dataset (Tiny - 5 KB)

**URL**: https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv

**Size**: 5 KB, 150 rows

**Columns**: sepal_length, sepal_width, petal_length, petal_width, species

**Good for testing**:

- Classification analysis
- Statistical measures
- Species comparisons
- Scientific data

**Example queries**:

```bash
# Average measurements by species
./db --csv "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv" \
  "SELECT species, AVG(sepal_length), AVG(petal_length) FROM data GROUP BY species"

# Natural language
./db --csv "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv" \
  --ask "which species has the largest petals on average?"

# Agentic investigation
./db --csv "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv" \
  --ask "analyze differences between iris species and find distinguishing characteristics" --auto
```

---

## 9. Google Sheets - Student Class Data (Small - ~2 KB)

**URL**: https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0

**Sheet ID**: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

**Size**: ~2 KB, ~30 rows

**Columns**: Name, Gender, Class Level, State, Major, Extracurricular

**Good for testing**:

- Google Sheets integration
- Student demographics
- Educational data
- Categorical grouping

**Example queries**:

```bash
# Count by major
./db --csv "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0" \
  "SELECT Major, COUNT(*) as count FROM data GROUP BY Major ORDER BY count DESC"

# Natural language
./db --csv "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0" \
  --ask "how many students are in each class level?"

# Agentic investigation
./db --csv "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=0" \
  --ask "analyze student distribution by state, major, and extracurriculars" --auto
```

**Note**: Google Sheets work via CSV export URLs. Format: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=0`

---

## Additional Datasets (Various Sizes)

### Large Performance Testing Datasets (Datablist - Google Drive)

For testing with very large files (100K - 2M records), use these Google Drive links:

**Customers Dataset** (synthetic data):

- 100K records: https://drive.google.com/uc?id=1N1xoxgcw2K3d-49tlchXAWw4wuxLj7EV&export=download
- 1M records: https://drive.google.com/uc?id=16WH96smhIT0KK0ZVJRpjymLa_XDhKOoD&export=download
- 2M records: https://drive.google.com/uc?id=1IXQDp8Um3d-o7ysZLxkDyuvFj9gtlxqz&export=download

**Note**: Google Drive links may require manual download and may not work as direct URLs in the tool. Better for local file testing.

---

## Testing Strategy by Category

### Performance Testing

- **Tiny (< 10 KB)**: Iris, Car Sales
- **Small (< 100 KB)**: Air Travel, Titanic, College Grads
- **Medium (100 KB - 1 MB)**: Seattle Weather, Apple Stock
- **Large (> 1 MB)**: COVID-19 (5.3 MB)

### Query Complexity Testing

- **Simple SELECT/COUNT**: Iris, Car Sales
- **Aggregations/GROUP BY**: Titanic, College Grads, COVID-19
- **Time Series**: Air Travel, Weather, Apple Stock, Car Sales
- **Multi-dimensional**: COVID-19, Titanic, College Grads

### AI Feature Testing

- **Simple --ask questions**: All datasets
- **Trend analysis --auto**: Weather, Stock, Air Travel, COVID-19
- **Root cause --auto**: Titanic, College Grads
- **Pattern detection --auto**: COVID-19, Weather, Stock

### Engine Testing

- **csv-sqlite (default)**: All datasets
- **csv-duckdb (performance)**: COVID-19, Weather, Apple Stock
- **URL caching**: All GitHub/URL datasets

---

## Running Comprehensive Tests

### Test All Datasets (Basic)

```bash
# Create a quick test script
for url in \
  "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" \
  "https://raw.githubusercontent.com/jbrownlee/Datasets/master/monthly-car-sales.csv" \
  "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv" \
  "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv"
do
  echo "Testing: $url"
  ./db --csv "$url" "SELECT COUNT(*) as row_count FROM data"
  echo ""
done
```

### Test AI Features on Diverse Datasets

```bash
# Export API key first
export ANTHROPIC_API_KEY='your-key-here'

# Air travel analysis
./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" \
  --ask "analyze passenger growth trends" --auto

# Titanic survival analysis
./db --csv "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" \
  --ask "what factors most influenced survival?" --auto

# College major analysis
./db --csv "https://raw.githubusercontent.com/fivethirtyeight/data/master/college-majors/recent-grads.csv" \
  --ask "which college majors have the best career outcomes?" --auto
```

---

## Dataset Characteristics Summary

| Feature                  | Best Datasets                                   |
| ------------------------ | ----------------------------------------------- |
| **Time series analysis** | Air Travel, Weather, Stock, Car Sales, COVID-19 |
| **Categorical analysis** | Titanic, Iris, College Grads                    |
| **Large aggregations**   | COVID-19, Weather                               |
| **Financial analysis**   | Apple Stock                                     |
| **Scientific data**      | Iris, Weather                                   |
| **Social data**          | Titanic, College Grads                          |
| **Health data**          | COVID-19                                        |

---

## Cache Testing

All URL datasets will be cached for 1 hour in `~/.cache/db-cli/`. Test cache behavior:

```bash
# First run - downloads
time ./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" "SELECT COUNT(*) FROM data"

# Second run - uses cache (should be instant)
time ./db --csv "https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv" "SELECT COUNT(*) FROM data"

# Check cache
ls -lh ~/.cache/db-cli/
```

---

**Last Updated**: 2024
**Total Datasets**: 9 primary (including Google Sheets) + additional large test files
**Coverage**: Small to Large, Multiple domains, All AI features testable
**Test Coverage**: 33+ automated tests in tests.sh
